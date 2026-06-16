import { readFileSync } from 'node:fs';
import path from 'node:path';

export interface ModInfo {
    name: string;
    version: string;
    title: string;
    author: string;
    contact: string;
    homepage: string;
    factorio_version: string;
    description: string;
    dependencies: string[];
}

export interface Dependencies {
    required: string[];
    optional: string[];
    incompatible: string[];
}

export function getModInfo(modDir: string) {
    const filePath = path.join(modDir, 'info.json');
    return JSON.parse(readFileSync(filePath, 'utf-8')) as ModInfo
}

export function getDependencies(modDir: string) {
    const modInfo = getModInfo(modDir);
    const deps: Dependencies = {
        required: [],
        optional: [],
        incompatible: [],
    };

    // https://lua-api.factorio.com/latest/auxiliary/mod-structure.html#Dependency
    for(let dependency of modInfo.dependencies)
    {
        let parts = dependency.split(' ');
        if(parts[0] === '!')
        {
            deps.incompatible.push(parts[1]);
        }
        // Hidden or non-hidden optional deps are equivalent here as they're only a mod portal concept
        else if(parts[0] === '?' || parts[0] === '(?)')
        {
            deps.optional.push(parts[1]);
        }
        // For now ignoring ~ dependencies (dependency that doesn't affect load order)
        // I'm unsure of the use case and haven't encountered one, and mostly the engine needs dependencies for load order concerns
        else if(parts[0] !== '~')
        {
            deps.required.push(parts[0]);
        }
    }

    return deps;
}