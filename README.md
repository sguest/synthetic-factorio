# Synthetic Factorio

<!--Hidden version bump 3-->

Synthetic Factorio nodeJS runtime for unit testing mods.

This is **not** a Factorio emulator, it is not a game that can be played.

```typescript
import { ModManager, FactorioEngine } from 'synthetic-factorio';

const manager = new ModManager();
// install vanilla "mod" data from https://github.com/wube/factorio-data (requires git CLI)
await manager.installVanillaMods();
// install mod by name from mod portal (requires FACTORIO_USERNAME and FACTORIO_TOKEN env variables)
await manager.installPortalMod('SimpleSeablock');
// install a mod in development from local files
manager.installDirectoryMod('my-mod', './my-mod-files', { clearCache: true });

// initialize the synthetic factorio engine and specify the mods that should be active
// vanilla "mods" need to be specified, including "base", however "core" does not need to be listed
const engine = new FactorioEngine({
    mods: ['base', 'space-age', 'quality', 'recycler', 'elevated-rails', 'my-mod']
});
// run all mods through their settings phase
engine.runSettingsPhase();
// customize settings for your specific test run
engine.setSettings({ startup: { 'my-mod-setting': true } });
// run all mods through their data phase
engine.runDataPhase();

// read the data.raw collection and run test assertions
console.log(engine.getRawData()['item']['stone-furnace']);

// run control phase - NOTE: control phase support is currently very limited
engine.runControlPhase(['my-mod']);

// run any registered on_init callbacks
engine.triggerInit();

// trigger an event with the payload of your choice
// Partial on the generic and casts on the sub-properties are recommended to avoid the need to setup the entire event payload
engine.triggerEvent<Partial<runtime.on_chunk_generated>>(defines.events.on_chunk_generated, {
    position: { x: 0, y: 0 },
    surface: { name: 'nauvis' } as runtime.LuaSurface,
});
```
