import { LuaState } from 'lua-state';
import type { LuaValue } from 'lua-state'
import { existsSync } from 'node:fs';
import path from 'node:path';
import { modDir } from './defaultValues.ts';
import { getDependencies, getModInfo } from './modInfoUtil.ts';

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

/**
 * A synthetic factorio runtime to run lua scripts and inspect their results
 */
export class FactorioEngine
{
    public luaState: LuaState;
    public readonly mods: string[];
    public readonly modDir: string;

    private settings: SettingsHolder;
    private ignoredDependencies: string[];
    private logHandler: (message: string) => void;

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
    }

    /**
     * Run the settings phase for all mods in dependency order and populate settings with the resulting defaults
     */
    public runSettingsPhase() {
        const modOrder = this.getModOrder();

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
     */
    public runDataPhase() {
        this.luaState.setGlobal('settings', { startup: this.settings?.startup as unknown as LuaValue });
        this.luaState.setGlobal('mods', this.buildModsGlobal());

        const modOrder = this.getModOrder();

        for(let mod of modOrder) {
            this.runModFile(mod, 'data.lua');
        }

        for(let mod of modOrder) {
            this.runModFile(mod, 'data-updates.lua');
        }

        for(let mod of modOrder) {
            this.runModFile(mod, 'data-final-fixes.lua');
        }

        this.luaState.setGlobal('mods', null);
    }

    private buildModsGlobal() {
        let modsGlobal: { [key: string]: string } = {};
        for(let modName of this.mods) {
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
        for(let key in values)
        {
            settings[key] = { value: values[key]};
        }
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
        luaState.evalFile('util_scripts/data_setup.lua');
        luaState.evalFile('util_scripts/defines.lua');
        luaState.evalFile('util_scripts/require_handler.lua');

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