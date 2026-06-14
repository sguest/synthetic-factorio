import { LuaState } from 'lua-state';
import { cpSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export class FactorioEngine
{
    public luaState: LuaState;
    private mods: string[] = [];

    constructor() {
        this.luaState = this.initLua();
        this.addMod('core', '../factorio-data/core');
    }

    public addMod(modName: string, sourcePath: string) {
        this.mods.push(modName);
        const targetPath = this.getModPath(modName);
        if(!existsSync(targetPath)) {
            cpSync(sourcePath, targetPath);
        }
    }

    public runDataPhase() {
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

    public getRawData() {
        return this.luaState.getGlobal('data.raw');
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
        for(let mod of this.mods) {
            let modInfo = JSON.parse(readFileSync(path.join(this.getModPath(mod), 'info.json'), 'utf-8'));
            let dependentMods = modInfo.dependencies.map((d: string) => d.split(' ')[0]);
            modGraph[mod] = dependentMods;
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
                throw new Error('Circular dependency graph detected');
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