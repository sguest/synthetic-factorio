import path from 'node:path';
import { promisify } from 'node:util';
import { exec } from 'node:child_process';
import { cpSync, createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import fetch from 'node-fetch';
import { glob } from 'glob';
import semverCompare from 'semver-compare';
import { pipeline } from 'node:stream';
import extractZip from 'extract-zip';
import { getDependencies, getModInfo } from './modInfoUtil.ts';
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
    /**
     * Function to accept diagnostic logging, if not supplied then no diagnostics will be logged. Can be verbose, primarily intended for troubleshooting
     * @param message Message to be logged
     */
    logger?: (message: string) => void;
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

const vanillaMods = ['core', 'base', 'quality', 'recycler', 'elevated-rails', 'space-age'];

/**
 * Utility class to download/install mods so they can be found by FactorioEngine
 */
export class ModManager
{
    public readonly modDir;
    public readonly workingDir;
    public readonly log: (message: string) => void;

    constructor(options?: ModManagerOptions) {
        this.modDir = options?.modDir || modDir();
        this.workingDir = options?.workingDir || workingDir();
        this.log = options?.logger || (() => {});
    }

    /**
     * Download all vanilla "mod" data from https://github.com/wube/factorio-data
     * Requires git to be available at the command line
     * @param options Mod Installation options
     */
    public async installVanillaMods(options?: ModDownloadOptions)
    {
        const run = promisify(exec);
        const gitDir = path.join(this.workingDir, 'factorio-data');
        this.log(`Installing vanilla mods at ${gitDir}`);
        if(existsSync(gitDir) && options?.clearDownload) {
            this.log(`gitDir ${gitDir} exists, deleting`);
            rmSync(gitDir, { recursive: true });
        }

        if(existsSync(gitDir) && options?.checkLatest) {
            this.log(`Vanilla mod repo exists at ${gitDir}, pulling latest`)
            await run('git pull', { cwd: gitDir });
        }

        if(!existsSync(gitDir)) {
            this.log(`Vanilla mod repo does not exist at ${gitDir}, cloning`)
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
        this.log(`Installing mod ${modName} to ${targetPath} from ${sourcePath}`);
        if(existsSync(targetPath) && options?.clearCache)
        {
            this.log(`Removing existing mod ${modName} at ${targetPath}`);
            rmSync(targetPath, { recursive: true });
        }
        if(!existsSync(targetPath)) {
            this.log(`Copying mod ${modName} from ${sourcePath} to ${targetPath}`);
            cpSync(sourcePath, targetPath, { recursive: true });
        }
        else
        {
            this.log(`Mod ${modName} already exists at ${targetPath}`);
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
        this.log(`Installing ${modName} from portal`);
        let modInfo: ApiModInfo | undefined = undefined;
        let targetVersion: string | undefined = undefined;
        const downloadDir = path.join(this.workingDir, 'downloads');
        mkdirSync(downloadDir, { recursive: true });

        if(options?.version)
        {
            targetVersion = options?.version;
            this.log(`Mod ${modName} installed at specific version ${targetVersion}`);
        }
        else if(options?.checkLatest)
        {
            modInfo = await this.getModInfo(modName);
            targetVersion = modInfo.releases.slice(-1)[0].version
            this.log(`Mod ${modName} latest version is ${targetVersion}`);
        }

        let zipPath: string | undefined = undefined;

        if(targetVersion)
        {
            zipPath = path.join(downloadDir, `${modName}_${targetVersion}.zip`);
            this.log(`Installing mod ${modName} at target version ${targetVersion} to ${zipPath}`);
        }
        else
        {
            const modFiles = await glob(`${modName}_*.zip`, { cwd: downloadDir});

            if(modFiles.length) {
                this.log(`Found ${modFiles.length} existing versions of mod ${modName}`);
                let latest = '0.0.0';

                for(const file of modFiles) {
                    const version = file.replace(/\.zip$/, '').split('_').slice(-1)[0]
                    if(semverCompare(latest, version) < 0)
                    {
                        latest = version
                    }
                }

                this.log(`Latest downloaded version of ${modName} is ${latest}`);

                zipPath = path.join(downloadDir, `${modName}_${latest}.zip`);
                this.log(`Using zip path ${zipPath} for ${modName}`);
            }
            else
            {
                this.log(`Did not find previously-installed version of ${modName}`);
            }
        }

        if(zipPath && options?.clearDownload) {
            this.log(`Deleting existing zip at ${zipPath} for ${modName}`);
            rmSync(zipPath);
        }

        if(!zipPath)
        {
            if(!modInfo)
            {
                modInfo = await this.getModInfo(modName);
            }
            targetVersion = modInfo.releases.slice(-1)[0].version;
            this.log(`Found ${targetVersion} version of ${modName} from mod info`);
            zipPath = path.join(downloadDir, `${modName}_${targetVersion}.zip`);
            this.log(`Using zip path ${zipPath} for ${modName}`);
        }

        if(!existsSync(zipPath))
        {
            if(!modInfo)
            {
                modInfo = await this.getModInfo(modName);
            }

            let modDownloadUrl: string;

            if(targetVersion) {
                let url = modInfo.releases.find(r => r.version === targetVersion)?.download_url;
                if(url)
                {
                    modDownloadUrl = url
                    this.log(`Download url for ${modName} at target version ${targetVersion} is ${modDownloadUrl}`);
                }
                else
                {
                    throw new Error(`Cannot find version ${targetVersion} of mod ${modName}`);
                }
            }
            else
            {
                modDownloadUrl = modInfo.releases.slice(-1)[0].download_url;
                this.log(`Download url for ${modName} is ${modDownloadUrl}`);
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

        let isOutdated = false;
        const targetPath = this.getModPath(modName);
        this.log(`Using path ${targetPath} for ${modName}`);
        if(existsSync(targetPath) && targetVersion) {
            const modInfo = getModInfo(targetPath);
            if(modInfo.version != targetVersion) {
                isOutdated = true;
                this.log(`Mod ${modName} is outdated`);
            }
        }

        await this.installZipMod(modName, zipPath, { ...options, clearCache : isOutdated ? true : options?.clearCache });

        if(!options?.skipDependencies)
        {
            const dependencies = getDependencies(this.getModPath(modName));

            for(let dependency of dependencies.required) {
                if(!vanillaMods.includes(dependency) && !options?.omitDependencies?.includes(dependency)) {
                    this.log(`Installing dependency ${dependency} for ${modName}`);
                    await this.installPortalMod(dependency, { ...options, version: undefined })
                }
                else
                {
                    this.log(`Not necessary to install dependency ${dependency} for ${modName}`);
                }
            }
        }
        else
        {
            this.log(`Skipping dependencies for ${modName}`);
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
        this.log(`Installing ${modName} as zip from ${sourcePath} to ${targetPath}`);
        if(existsSync(targetPath) && options?.clearCache)
        {
            this.log(`Deleting existing mod ${modName} at ${targetPath}`);
            rmSync(targetPath, { recursive: true});
        }
        if(!existsSync(targetPath)) {
            const unzipDir = path.join(this.workingDir, 'unzip');
            this.log(`Unzipping ${modName} from ${sourcePath} to ${unzipDir}`);
            mkdirSync(unzipDir, { recursive: true });
            await extractZip(sourcePath, { dir: unzipDir });
            // Mod contents are in a single dir inside the zip file, and the dir can have any name so we need to handle that
            const dirs = readdirSync(unzipDir)
            const sourceDir = path.join(unzipDir, dirs[0]);
            this.log(`Renaming ${sourceDir} to ${targetPath} for ${modName}`);
            renameSync(sourceDir, targetPath);
        }
        else
        {
            this.log(`Mod zip ${modName} already exists at ${targetPath}, no action needed`);
        }
    }

    private getModPath(modName: string) {
        return path.join(this.modDir, `__${modName}__`)
    }
}