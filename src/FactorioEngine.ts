import { LuaState } from 'lua-state';
import type { LuaValue } from 'lua-state'
import { cpSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export class FactorioEngine
{
    public luaState: LuaState;
    private mods: { [key: string]: string } = {};
    private settings?: runtime.LuaSettings;

    constructor() {
        this.luaState = this.initLua();
        this.addMod('core', '../factorio-data/core');
    }

    public addMod(modName: string, sourcePath: string) {
        const targetPath = this.getModPath(modName);
        if(!existsSync(targetPath)) {
            cpSync(sourcePath, targetPath, { recursive: true });
        }
        const modInfo = this.getModInfo(modName);
        this.mods[modName] = modInfo.version;
        this.luaState.setGlobal('mods', this.mods);
    }

    public runSettingsPhase() {
        const modOrder = this.getModOrder();

        for(let mod of modOrder) {
            this.runModFile(mod, 'settings.lua')
        }

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

    public runDataPhase() {
        this.luaState.setGlobal('settings', { startup: this.settings?.startup as unknown as LuaValue })
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
    }

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
        let modGraph: {[key: string]: string[]} = {};
        for(let modName in this.mods) {
            let modInfo = this.getModInfo(modName);
            let dependentMods = (modInfo.dependencies as string[]).map(d => d.split(' ')[0]).filter(d => d !== '!' && d !== '?');
            modGraph[modName] = dependentMods;
        }
        let modOrder: string[] = [];

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
                // todo - better feedback as to what broke
                throw new Error('Dependency graph error');
            }

            modOrder.push(targetMod);

            delete modGraph[targetMod];

            for(let key in modGraph) {
                let index = modGraph[key].indexOf(targetMod);
                if(index >= 0) {
                    modGraph[key].splice(index, 1);
                }
            }
        }

        return modOrder;
    }

    private getModPath(modName: string) {
        return path.join(import.meta.dirname, `../mods/__${modName}__`);
    }

    private getModInfo(modName: string) {
        return JSON.parse(readFileSync(path.join(this.getModPath(modName), 'info.json'), 'utf-8'));
    }

    private initLua() {
        const luaState = new LuaState();
        luaState.setGlobal('print', console.log);
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
            './mods/?.lua',
            `./mods/__${modName}__/?.lua`,
            './mods/__core__/?.lua',
            './mods/__core__/lualib/?.lua',
        );
        this.luaState.evalFile('util_scripts/clear_imports.lua');
        if(modName === 'core' || modName === 'base' || modName === 'quality' || modName === 'elevated-rails' || modName === 'space-age') {
            this.luaState.setGlobal('suppress_require_errors', true);
        }
        else
        {
            this.luaState.setGlobal('suppress_require_errors', false);
        }
    }
}