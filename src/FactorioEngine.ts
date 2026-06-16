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

/**
 * A synthetic factorio runtime to run lua scripts and inspect their results
 */
export class FactorioEngine
{
    public luaState: LuaState;
    public readonly mods: string[];
    public readonly modDir: string;

    private settings?: runtime.LuaSettings;
    private ignoredDependencies: string[];
    private logHandler: (message: string) => void;

    constructor(options: FactorioEngineOptions) {
        this.luaState = this.initLua();
        this.mods = options.mods;
        this.modDir = options.modDir || modDir();
        this.ignoredDependencies = options.ignoredDependencies || [];
        this.logHandler = options.logHandler || console.log;
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

        const settings: runtime.LuaSettings = {
            startup: {},
            global: {},
            player_default: {},
            object_name: 'settings',
            get_player_settings: () => settings.player_default,
        };

        for(let settingType of ['bool-setting', 'int-setting', 'double-setting', 'string-setting', 'color-setting']) {
            if(data[settingType]) {
                for(let name in data[settingType]) {
                    let setting = data[settingType][name];
                    if(setting.setting_type === 'startup') {
                        settings.startup[setting.name] = { value: setting.default_value } as runtime.ModSetting;
                    }
                    else if(setting.setting_type === 'runtime-global') {
                        settings.global[setting.name] = { value: setting.default_value } as runtime.ModSetting;
                    }
                    else if(setting.setting_type === 'runtime-per-user') {
                        settings.player_default[setting.name] = { value: setting.default_value } as runtime.ModSetting;
                    }
                }
            }
        }

        this.settings = settings;
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
                throw new Error('Circular dependency detected');
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
            `${this.modDir}/__${modName}__/?.lua`,  // default import path, when a mod imports files relative to its own root
            `${this.modDir}/__core__/lualib/?.lua`, // lualib files are available to import by name to all mods
            `${this.modDir}/?.lua`,                 // importing from other mods is allowed, using the __modname__/path syntax
            `${this.modDir}/__base__/?.lua`,        // Some mods require from vanilla mods, so add them back in as lower priority
            `${this.modDir}/__space-age__/?.lua`,
            `${this.modDir}/__elevated-rails__/?.lua`,
            `${this.modDir}/__quality__/?.lua`,
        );
        this.luaState.evalFile('util_scripts/clear_imports.lua');

        // see require_handler.lua
        if(modName === 'core' || modName === 'base' || modName === 'quality' || modName === 'elevated-rails' || modName === 'space-age') {
            this.luaState.setGlobal('suppress_require_errors', true);
        }
        else
        {
            this.luaState.setGlobal('suppress_require_errors', false);
        }
    }
}