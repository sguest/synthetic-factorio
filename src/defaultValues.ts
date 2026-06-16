import envPaths from 'env-paths';
import path from 'path';

export const libName = 'synthetic-factorio';
export const modDir = () => path.join(envPaths(libName).cache, 'mods');
export const workingDir = () => path.join(envPaths(libName).cache, 'working');