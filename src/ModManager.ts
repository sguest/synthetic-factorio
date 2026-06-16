import path from 'node:path';
import { promisify } from 'node:util';
import { exec } from 'node:child_process';
import { cpSync, createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import fetch from 'node-fetch';
import { glob } from 'glob';
import semverCompare from 'semver-compare';
import { pipeline } from 'node:stream';
import extractZip from 'extract-zip';
import { getDependencies } from './modInfoUtil.ts';
import { modDir, workingDir } from './defaultValues.ts';

interface ApiModInfo {
    category: string;
    downloads_count: number
    last_highlighted_at: string;
    name: string;
    owner: string;
    releases: {
        download_url: string;
        file_name: string;
        released_at: string;
        sha1: string;
        version: string;
        info_json: {
            factorio_version: string;
        }
    }[]
}

export interface ModManagerOptions {
    /**
     * Directory where mods are installed
     */
    modDir?: string;
    /**
     * Working directory for files like mod downloads
     */
    workingDir?: string;
}

export interface ModInstallOptions {
    /**
     * Clear previously-installed files and re-install
     */
    clearCache?: boolean;
}

export interface ModDownloadOptions extends ModInstallOptions {
    /**
     * Clear previously-downloaded files and force re-download
     */
    clearDownload?: boolean;
    /**
     * Check if a newer version exists and download if needed
     */
    checkLatest?: boolean;
}

export interface ModPortalDownloadOptions extends ModDownloadOptions {
    /**
     * Version of the mod to download, if omitted either installs latest from portal or uses latest downloaded depending on `checkLatest` option.
     */
    version?: string;

    /**
     * True to skip installing dependent mods. By default all required dependent mods are installed.
     */
    skipDependencies?: boolean;

    /**
     * Dependencies in this list will be skipped, useful for skipping large asset-only deps that are not needed for testing.
     */
    omitDependencies?: string[];
}

const vanillaMods = ['core', 'base', 'quality', 'elevated-rails', 'space-age'];

/**
 * Utility class to download/install mods so they can be found by FactorioEngine
 */
export class ModManager
{
    public readonly modDir;
    public readonly workingDir;

    constructor(options?: ModManagerOptions) {
        this.modDir = options?.modDir || modDir();
        this.workingDir = options?.workingDir || workingDir();
    }

    /**
     * Download all vanilla "mod" data from https://github.com/wube/factorio-data
     * @param options Mod Installation options
     */
    public async installVanillaMods(options?: ModDownloadOptions)
    {
        const run = promisify(exec);
        const gitDir = path.join(this.workingDir, 'factorio-data');
        if(existsSync(gitDir) && options?.clearDownload) {
            rmSync(gitDir, { recursive: true });
        }

        if(existsSync(gitDir) && options?.checkLatest) {
            await run('git pull', { cwd: gitDir });
        }

        if(!existsSync(gitDir)) {
            mkdirSync(this.workingDir, { recursive: true })
            await run('git clone --depth=1 https://github.com/wube/factorio-data.git', { cwd: this.workingDir });
        }

        for(let mod of vanillaMods) {
            this.installDirectoryMod(mod, path.join(gitDir, mod), options);
        }
    }

    /**
     * Install mod from a directory - essentially a directory copy to the correct location
     * @param modName Name of the mod
     * @param sourcePath Path to copy from
     * @param options Mod Installation Options
     */
    public installDirectoryMod(modName: string, sourcePath: string, options?: ModInstallOptions)
    {
        const targetPath = this.getModPath(modName);
        if(existsSync(targetPath) && options?.clearCache)
        {
            rmSync(targetPath);
        }
        if(!existsSync(targetPath)) {
            cpSync(sourcePath, targetPath, { recursive: true });
        }
    }

    /**
     * Downloads and installs a mod from Factorio's mod portal.
     * Requires the environment variables FACTORIO_USERNAME and FACTORIO_TOKEN to be set
     * @param modName Name of the mod
     * @param options Mod Installation Optiions
     */
    public async installPortalMod(modName: string, options?: ModPortalDownloadOptions)
    {
        let modInfo: ApiModInfo | undefined = undefined;
        let targetVersion: string | undefined = undefined;
        const downloadDir = path.join(this.workingDir, 'downloads');
        mkdirSync(downloadDir, { recursive: true });

        if(options?.version)
        {
            targetVersion = options?.version;
        }
        else if(options?.checkLatest)
        {
            modInfo = await this.getModInfo(modName);
            targetVersion = modInfo.releases.slice(-1)[0].version
        }

        let zipPath: string | undefined = undefined;

        if(targetVersion)
        {
            zipPath = path.join(downloadDir, `${modName}_${targetVersion}.zip`);
        }
        else
        {
            const modFiles = await glob(`${modName}_*.zip`, { cwd: downloadDir});

            if(modFiles.length) {
                let latest = '0.0.0';

                for(const file of modFiles) {
                    const version = file.replace(/\.zip$/, '').split('_').slice(-1)[0]
                    if(semverCompare(latest, version) < 0)
                    {
                        latest = version
                    }
                }

                zipPath = path.join(downloadDir, `${modName}_${latest}.zip`);
            }
        }

        if(zipPath && options?.clearDownload) {
            rmSync(zipPath);
        }

        if(!zipPath)
        {
            if(!modInfo)
            {
                modInfo = await this.getModInfo(modName);
            }
            targetVersion = modInfo.releases.slice(-1)[0].version;
            zipPath = path.join(downloadDir, `${modName}_${targetVersion}.zip`);
        }

        if(!existsSync(zipPath))
        {
            if(!modInfo)
            {
                modInfo = await this.getModInfo(modName);
            }

            let modDownloadUrl: string;

            if(options?.version) {
                let url = modInfo.releases.find(r => r.version === options.version)?.download_url;
                if(url)
                {
                    modDownloadUrl = url
                }
                else
                {
                    throw new Error(`Cannot find version ${options.version} of mod ${modName}`);
                }
            }
            else
            {
                modDownloadUrl = modInfo.releases.slice(-1)[0].download_url;
            }

            if(!process.env.FACTORIO_USERNAME) {
                throw new Error('Cannot download mod, env variable FACTORIO_USERNAME is not set')
            }
            if(!process.env.FACTORIO_TOKEN) {
                throw new Error('Cannot download mod, env variable FACTORIO_TOKEN is not set')
            }

            const apiDownloadUrl = `https://mods.factorio.com/${modDownloadUrl}?username=${process.env.FACTORIO_USERNAME}&token=${process.env.FACTORIO_TOKEN}`;
            const streamPipeline = promisify(pipeline);
            const response = await fetch(apiDownloadUrl);

            if(!response.ok || !response.body)
            {
                throw new Error(`Failed to download mod ${modName}: ${response.statusText}`);
            }

            await streamPipeline(response.body, createWriteStream(zipPath));
        }

        await this.installZipMod(modName, zipPath, options);

        if(!options?.skipDependencies)
        {
            const dependencies = getDependencies(this.getModPath(modName));

            for(let dependency of dependencies.required) {
                if(!vanillaMods.includes(dependency) && !options?.omitDependencies?.includes(dependency)) {
                    this.installPortalMod(dependency, { ...options, version: undefined })
                }
            }
        }
    }

    private async getModInfo(modName: string): Promise<ApiModInfo>
    {
        const response = await fetch(`https://mods.factorio.com/api/mods/${modName}`);
        return (await response.json()) as ApiModInfo;
    }

    /**
     * Install a mod from a zip file
     * @param modName Name of the mod
     * @param sourcePath Path to the zip file
     * @param options Mod Installation Options
     */
    public async installZipMod(modName: string, sourcePath: string, options?: ModInstallOptions)
    {
        const targetPath = this.getModPath(modName);
        if(existsSync(targetPath) && options?.clearCache)
        {
            rmSync(targetPath);
        }
        if(!existsSync(targetPath)) {
            const unzipDir = path.join(this.workingDir, 'unzip');
            mkdirSync(unzipDir, { recursive: true });
            await extractZip(sourcePath, { dir: unzipDir });
            // Mod contents are in a single dir inside the zip file, and the dir can have any name so we need to handle that
            let dirs = readdirSync(unzipDir)
            renameSync(path.join(unzipDir, dirs[0]), targetPath);
        }
    }

    private getModPath(modName: string) {
        return path.join(this.modDir, `__${modName}__`)
    }
}