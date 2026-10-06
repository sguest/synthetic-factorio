import * as fs from 'fs';
import path from 'path';
import { pipeline } from 'stream';
import { promisify } from 'util';

const streamPipeline = promisify(pipeline);
const response = await fetch('https://lua-api.factorio.com/latest/prototype-api.json');

if(!response.ok || !response.body)
{
    throw new Error('Failed to download prototype API');
}

const filePath = path.join(import.meta.dirname, '../temp/prototype-api.json')

await streamPipeline(response.body, fs.createWriteStream(filePath));

const contents = fs.readFileSync(filePath, 'utf-8');

const prototypes = JSON.parse(contents)

let luaOutput = 'defines = {}\n';
let tsOutput = 'export const defines = {\n';

const writeLuaDefine = (define: any, prefix = 'defines') => {
    const defineName = `${prefix}['${define.name}']`;

    if(define.values || define.subkeys) {
        luaOutput += `${defineName} = {}\n`;

        for(let value of define.values ?? []) {
            luaOutput += `${defineName}['${value.name}'] = ${value.order}\n`;
        }

        for(let subkey of define.subkeys ?? []) {
            writeLuaDefine(subkey, defineName);
        }
    }
    else {
        luaOutput += `${defineName} = ${define.order}\n`;
    }


    luaOutput += '\n';
}

const writeTsDefine = (define: any, indent = '    ', prefix = 'defines') => {
    if(define.values || define.subkeys) {
        tsOutput += `${indent}'${define.name}': {\n`

        for(let value of define.values ?? []) {
            tsOutput += `${indent}    '${value.name}': ${value.order},\n`
        }

        for(let subkey of define.subkeys ?? []) {
            writeTsDefine(subkey, indent + '    ');
        }

        tsOutput += `${indent}},\n`
    }
    else
    {
        tsOutput += `${indent}'${define.name}': ${define.order},\n`
    }

    tsOutput += '\n';
}

for(let define of prototypes.defines) {
    writeLuaDefine(define);
    writeTsDefine(define)
}

tsOutput += '}';

fs.writeFileSync(import.meta.dirname + '/../util_scripts/defines.lua', luaOutput);
fs.writeFileSync(import.meta.dirname + '/../src/defines.ts', tsOutput);
