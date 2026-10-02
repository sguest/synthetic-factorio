import { LuaState } from 'lua-state';
import type { LuaValue } from 'lua-state'
import { existsSync } from 'node:fs';
import path, { dirname } from 'node:path';
import { modDir } from './defaultValues.ts';
import { getDependencies, getModInfo } from './modInfoUtil.ts';
import { fileURLToPath } from 'node:url';

export interface FactorioEngineOptions {
    /**
     * List of mods to execute. Include "vanilla" mods like base or elevated-rails if needed.
     */
    mods: string[];
    /**
     * Directory where mods are executed from
     */
    modDir?: string;
    /**
     * Any mod in this list will be ignored when checking dependencies of other installed mods.
     */
    ignoredDependencies?: string[];
    /**
     * Calls to log() in mods will be funnelled through this callback. Defaults to console.log if not specified.
     * @param message the message to log
     */
    logHandler?: (message: string) => void
}

type SettingValue = number | boolean | string | runtime.Color;

interface SettingsData {
    global?: Record<string, SettingValue>,
    player?: Record<string, SettingValue>,
    startup?: Record<string, SettingValue>
}

interface SettingsHolder {
    global: Record<string, runtime.ModSetting>
    player_default: Record<string, runtime.ModSetting>
    startup: Record<string, runtime.ModSetting>
    get_player_settings: () => Record<string, runtime.ModSetting>
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Special event data type with name and tick made optional so the engine can default it
// Much better than the need to set them each time since they're both required
type EventPayload = Omit<runtime.EventData, "name" | "tick"> & Partial<Pick<runtime.EventData, "name" | "tick">>

type EventHandler = (payload: EventPayload) => void;

interface ModRuntimeContext {
    eventHandlers: { [key in defines.events]?: EventHandler[] };
    initHandlers: Array<() => void>;
    storage: { [key: string] : any };
}

/**
 * A synthetic factorio runtime to run lua scripts and inspect their results
 */
export class FactorioEngine
{
    public luaState: LuaState;
    public readonly mods: string[];
    public readonly modDir: string;

    public settings: SettingsHolder;
    private remoteInterfaces: { [key: string]: { [key: string]: true } }; 
    private remoteHandlers: { [key: string]: { [key: string] : (...args: any[]) => any }};
    private ignoredDependencies: string[];
    private logHandler: (message: string) => void;
    private modRuntimes: { [key: string]: ModRuntimeContext } = {};

    constructor(options: FactorioEngineOptions) {
        this.luaState = this.initLua();
        this.mods = options.mods;
        this.modDir = options.modDir || modDir();
        this.ignoredDependencies = options.ignoredDependencies || [];
        this.logHandler = options.logHandler || console.log;
        this.settings = {
            startup: {},
            global: {},
            player_default: {},
            // This should handle proper per-player settings, good enough for now
            get_player_settings: () => settings.player_default,
        };
        this.remoteInterfaces = {};
        this.remoteHandlers = {};
    }

    /**
     * Run the settings phase for all mods in dependency order and populate settings with the resulting defaults
     * @param mods Run the specified mods in order. Omit to run all mods in dependency order.
     */
    public runSettingsPhase(mods: string[] | undefined = undefined) {
        const modOrder = mods || this.getModOrder();

        this.luaState.setGlobal('mods', this.buildModsGlobal());

        for(let mod of modOrder) {
            this.runModFile(mod, 'settings.lua')
        }

        this.luaState.setGlobal('mods', null);

        const data = this.getRawData() as unknown as { [key: string]: { [key: string]: settings.dataExtendType } };

        const settingsData: SettingsData = {
            startup: {},
            global: {},
            player: {},
        };

        for(let settingType of ['bool-setting', 'int-setting', 'double-setting', 'string-setting', 'color-setting']) {
            if(data[settingType]) {
                for(let name in data[settingType]) {
                    let setting = data[settingType][name];
                    if(setting.setting_type === 'startup') {
                        settingsData.startup![setting.name] = setting.default_value as SettingValue;
                    }
                    else if(setting.setting_type === 'runtime-global') {
                        settingsData.global![setting.name] = setting.default_value as SettingValue;
                    }
                    else if(setting.setting_type === 'runtime-per-user') {
                        settingsData.player![setting.name] = setting.default_value as SettingValue;
                    }
                }
            }
        }

        this.setSettings(settingsData);
    }

    /**
     * Run the data phase for all mods in dependency order
     * @param mods Run the specified mods in order. Omit to run all mods in dependency order.
     */
    public runDataPhase(mods: string[] | undefined = undefined) {
        this.luaState.setGlobal('settings', { startup: this.settings?.startup as unknown as LuaValue });
        this.luaState.setGlobal('mods', this.buildModsGlobal());

        const modOrder = mods || this.getModOrder();

        for(const mod of modOrder) {
            this.runModFile(mod, 'data.lua');
        }

        for(const mod of modOrder) {
            this.runModFile(mod, 'data-updates.lua');
        }

        for(const mod of modOrder) {
            this.runModFile(mod, 'data-final-fixes.lua');
        }

        this.luaState.setGlobal('mods', null);
    }

    private buildModsGlobal() {
        const modsGlobal: { [key: string]: string } = {};
        for(const modName of this.mods) {
            modsGlobal[modName] = this.getModInfo(modName).version;
        }
        return modsGlobal;
    }

    /**
     * Get the current data.raw prototype collection
     * @returns data collection
     */
    public getRawData(): prototype.dataCollection {
        return (this.luaState.getGlobal('data.raw') || {}) as unknown as prototype.dataCollection;
    }

    /**
     * Apply settings that will be retrievable by mods
     * @param settings Settings to apply
     */
    public setSettings(settings: SettingsData) {
        this.mergeSettings(this.settings.global, settings.global);
        this.mergeSettings(this.settings.startup, settings.startup);
        this.mergeSettings(this.settings.player_default, settings.player);
    }

    private mergeSettings(settings: Record<string, runtime.ModSetting>, values?: Record<string, SettingValue>)
    {
        for(const key in values)
        {
            settings[key] = { value: values[key]};
        }
    }

    /**
     * Run the control phase for all mods in dependency order
     * @param mods Run the specified mods in order. Omit to run all mods in dependency order.
     */
    public runControlPhase(mods: string[] | undefined = undefined) {
        const modOrder = mods || this.getModOrder();

        for(const mod of modOrder) {
            this.initModRuntime(mod);
            this.luaState.setGlobal('script', {
                on_init: (handler: () => void) => {
                    this.modRuntimes[mod].initHandlers.push(handler);
                },
                on_event: (eventType: defines.events, handler: EventHandler) => {
                    this.modRuntimes[mod].eventHandlers[eventType] ||= [];
                    this.modRuntimes[mod].eventHandlers[eventType].push(handler);
                },
            } as any);

            this.luaState.eval(`script.mod_name = '${mod}'`);
            this.runModFile(mod, 'control.lua');
            this.postModRuntime(mod);
        }
    }

    /**
     * Trigger registered on_init handlers for all mods in dependency order
     * @param mods Run the specified mods in order. Omit to run all mods in dependency order.
     */
    public triggerInit(mods: string[] | undefined = undefined) {
        const modOrder = mods || this.getModOrder();

        for(const mod of modOrder) {
            this.initModRuntime(mod);
            const handlers = this.modRuntimes[mod].initHandlers || [];

            for(const handler of handlers)
            {
                handler();
            }
            this.postModRuntime(mod);
        }
    }

    /**
     * Trigger an event for all mods in dependency order
     * @param eventType The event type to trigger
     * @param payload The event payload
     * @param mods Run the specified mods in order. Omit to run all mods in dependency order.
     */
    public triggerEvent<T extends EventPayload>(eventType: defines.events, payload: T, mods: string[] | undefined = undefined) {
        const modOrder = mods || this.getModOrder();

        for(const mod of modOrder) {
            this.initModRuntime(mod);
            const handlers = this.modRuntimes[mod].eventHandlers[eventType] || [];
            payload.name ??= eventType;
            payload.tick ??= 0;

            for(let handler of handlers)
            {
                handler(payload);
            }
            this.postModRuntime(mod);
        }
    }

    public registerRemote(iface: string, fn: string, handler: (...args: any[]) => any) {
        this.remoteInterfaces[iface] ||= {};
        this.remoteInterfaces[iface][fn] = true;
        this.remoteHandlers[iface] ||= {};
        this.remoteHandlers[iface][fn] = handler;
    }

    private initModRuntime(mod: string) {
        this.modRuntimes[mod] ??= { eventHandlers: {}, initHandlers: [], storage: {}};
        this.luaState.setGlobal('storage', this.modRuntimes[mod].storage);
        this.luaState.setGlobal('remote', {
            interfaces: this.remoteInterfaces,
            call: (iface: string, fn: string, ...args: any[]) => {
                return this.remoteHandlers[iface][fn](...args);
            }
        } as any);
    }

    private postModRuntime(mod: string) {
        this.modRuntimes[mod].storage = this.luaState.getGlobal('storage') as { [key: string]: any };
    }

    private runModFile(modName: string, fileName: string) {
        const targetFile = path.join(this.getModPath(modName), fileName);
        if(existsSync(targetFile))
        {
            this.setModContext(modName);
            this.luaState.evalFile(targetFile);
        }
    }

    private getModOrder() {
        const modGraph: {[key: string]: string[]} = {};
        for(const modName of this.mods) {
            const dependencyInfo = getDependencies(this.getModPath(modName));

            var incompat = dependencyInfo.incompatible.find(d => this.mods.includes(d));
            if(incompat)
            {
                throw new Error(`Failed to load mods, ${modName} and ${incompat} are incompatible`)
            }

            const dependencies = dependencyInfo.required.filter(d => !this.ignoredDependencies.includes(d) || this.mods.includes(d));

            // If an optional dependency is installed, treat it as a regular one because it influences load order the same way
            // If an optional dependency is not installed, ignore it
            dependencies.push(...dependencyInfo.optional.filter(d => this.mods.includes(d)));

            modGraph[modName] = dependencies;
        }
        const modOrder: string[] = ['core'];

        for(const modName of this.mods) {
            const dependencies = modGraph[modName];
            const unmetDeps = dependencies.filter(d => !this.mods.includes(d))
            if(unmetDeps.length) {
                throw new Error(`Mod ${modName} is missing dependencies ${unmetDeps}`)
            }
        }

        let finished = false;

        while(!finished) {
            finished = true;
            let targetMod: string | undefined = undefined;

            for(let key in modGraph) {
                finished = false;
                if(!targetMod && modGraph[key].length === 0) {
                    targetMod = key;
                }
            }

            if(finished) {
                return modOrder;
            }

            if(!targetMod) {
                throw new Error(`Circular dependency detected, failed to finish resolving ${JSON.stringify(modGraph)}`);
            }

            modOrder.push(targetMod);

            delete modGraph[targetMod];

            for(const key in modGraph) {
                const index = modGraph[key].indexOf(targetMod);
                if(index >= 0) {
                    modGraph[key].splice(index, 1);
                }
            }
        }

        return modOrder;
    }

    private getModPath(modName: string) {
        return path.join(this.modDir, `../mods/__${modName}__`);
    }

    private getModInfo(modName: string) {
        return getModInfo(this.getModPath(modName));
    }

    private initLua() {
        const luaState = new LuaState();
        luaState.setGlobal('log', s => this.logHandler(s as string));
        const utilPath = path.join(__dirname, '../util_scripts');
        luaState.evalFile(path.join(utilPath, 'data_setup.lua'));
        luaState.evalFile(path.join(utilPath, 'defines.lua'));
        luaState.evalFile(path.join(utilPath, 'require_handler.lua'));

        /*Lua 5.3 deprecates math.atan2, but Factorio is on Lua 5.2.1
        Could downgrade Lua, but for now this patch seems to do it */
        luaState.eval('math.atan2 = math.atan');

        return luaState
    }

    private setPackagePaths(...paths: string[]) {
        this.luaState.eval(`package.path = '${[...paths].join(';').replace(/\\/g, '/')}'`);
    }

    private setModContext(modName: string) {
        this.setPackagePaths(
            // This is the main import path. The engine will try to rewrite mods to match this path first, making them relative to whatever mod's file is currently running
            // When a mod imports from another mod via __modname__.path syntax, that mod is injected at the root
            // See require_handler.lua for more
            `${this.modDir}/?.lua`,                 // importing from other mods is allowed, using the __modname__/path syntax
            // These all become active in the "second attempt" import if the first one fails
            `${this.modDir}/__core__/lualib/?.lua`, // lualib files are available to import by name to all mods
            `${this.modDir}/__base__/?.lua`,        // Some mods require from vanilla mods without specifying modname, which Factorio allows, so add them back in as lower priority
            `${this.modDir}/__space-age__/?.lua`,
            `${this.modDir}/__elevated-rails__/?.lua`,
            `${this.modDir}/__quality__/?.lua`,
            `${this.modDir}/__recycler__/?.lua`,
        );

        // Used by require_handler.lua to keep track of the current "state"
        this.luaState.eval(`current_mod_root_path = '${modName}'`)

        // see require_handler.lua
        if(modName === 'core' || modName === 'base' || modName === 'quality' || modName === 'recycler' || modName === 'elevated-rails' || modName === 'space-age') {
            this.luaState.setGlobal('suppress_require_errors', true);
        }
        else
        {
            this.luaState.setGlobal('suppress_require_errors', false);
        }
    }
}