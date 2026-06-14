// download https://lua-api.factorio.com/latest/prototype-api.json and put it in temp/prototype-api.json
// todo - automate this

import * as fs from 'fs';

var contents = fs.readFileSync(import.meta.dirname + '/../temp/prototype-api.json', 'utf-8');

var prototypes = JSON.parse(contents)

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
