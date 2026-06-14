import { LuaState } from 'lua-state';

const fixValue = (value: any) => {
    if(typeof value !== 'object') {
        return value;
    }

    // lua-state turns arrays into objects with numeric keys starting at 1, so assume this should be an array
    if(value[1]) {
        let arr = [];

        for(let key in value) {
            arr.push(value[key]);
        }

        return arr;
    }

    let returnValue = {} as any;

    for(let key in value) {
        returnValue[key] = fixValue(value[key]);
    }

    return returnValue;
}

// https://www.reddit.com/r/lua/comments/wi0bau/comment/ija0ar5/?utm_source=share&utm_medium=web3x&utm_name=web3xcss&utm_term=1&utm_content=share_button
const setPackagePaths = (luaState: LuaState, ...paths: string[]) => {
    luaState.eval(`package.path = '${[...paths].join(';').replace(/\\/g, '/')}'`);
}

const setModPackagePaths = (luaState: LuaState, modName: string) => {
    setPackagePaths(
        luaState,
        '../factorio-data/core/lualib/?.lua',
        '../factorio-data/core/?.lua',
        `../factorio-data/${modName}/?.lua`,
        './mods/?.lua',
        `./mods/__${modName}__/?.lua`,
    );
}

let dataRaw: any = {};

const initLua = () => {
    const luaState = new LuaState();
    luaState.setGlobal('print', console.log);
    luaState.setGlobal('data', { raw: dataRaw });
    luaState.evalFile('util_scripts/data_setup.lua');
    luaState.evalFile('util_scripts/defines.lua');

    /*Lua 5.3 deprecates math.atan2, but Factorio is on Lua 5.2.1
    Could downgrade Lua, but for now this patch seems to do it */
    luaState.eval('math.atan2 = math.atan');

    return luaState
}

const initMod = (luaState: LuaState, modName: string) => {
    setModPackagePaths(luaState, modName);
    luaState.evalFile('util_scripts/clear_imports.lua');
}

let lua = initLua();

initMod(lua, 'base');

lua.evalFile('../factorio-data/core/data.lua');
lua.evalFile('../factorio-data/base/data.lua');
lua.evalFile('../factorio-data/base/data-updates.lua');

initMod(lua, 'quality');
lua.evalFile('../factorio-data/quality/data.lua');
lua.evalFile('../factorio-data/quality/data-updates.lua');

initMod(lua, 'elevated-rails');
lua.evalFile('../factorio-data/elevated-rails/data.lua');

initMod(lua, 'space-age');

lua.evalFile('../factorio-data/space-age/data.lua');
lua.evalFile('../factorio-data/space-age/data-updates.lua');
//lua.eval("package.path = './mods/test-mod/?.lua;' .. package.path")
//lua.evalFile('./mods/test-mod/data.lua');

//console.log(lua.getGlobal('data.raw'));
console.log('done');