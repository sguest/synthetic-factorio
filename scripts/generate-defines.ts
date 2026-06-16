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

let output = 'defines = {}\n';

const writeDefine = (define: any, prefix = 'defines') => {
    const defineName = `${prefix}['${define.name}']`;

    if(define.values || define.subkeys) {
        output += `${defineName} = {}\n`;

        for(let value of define.values ?? []) {
            output += `${defineName}['${value.name}'] = ${value.order}\n`;
        }

        for(let subkey of define.subkeys ?? []) {
            writeDefine(subkey, defineName);
        }
    }
    else {
        output += `${defineName} = ${define.order}\n`;
    }


    output += '\n';
}

for(let define of prototypes.defines) {
    writeDefine(define);
}

fs.writeFileSync(import.meta.dirname + '/../util_scripts/defines.lua', output);
