import { FactorioEngine } from './src/FactorioEngine.ts';
import { ModManager } from './src/ModManager.ts';
import { loadEnvFile } from 'node:process';

loadEnvFile();

var manager = new ModManager();
manager.installVanillaMods();
manager.installPortalMod('SimpleSeablock');
manager.installPortalMod('space-is-fake', { omitDependencies: ['cr-commons'] });
manager.installPortalMod('any-planet-start');

var engine = new FactorioEngine({
    mods: ['base', 'space-age', 'quality', 'elevated-rails', 'SimpleSeablock', 'space-is-fake'],
    ignoredDependencies: ['cr-commons'],
    logHandler: () => {},
});
engine.runSettingsPhase();
engine.setSettings({ startup: { 'simple-seablock-disable-pumpjacks': false }});
engine.runDataPhase();

console.log(engine.getRawData()['item']['pumpjack']);