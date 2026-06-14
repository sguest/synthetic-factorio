import { FactorioEngine } from './src/FactorioEngine.ts';

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

var engine = new FactorioEngine();
engine.addMod('space-age', '../factorio-data/space-age');
engine.addMod('base', '../factorio-data/base');
engine.addMod('quality', '../factorio-data/quality');
engine.addMod('elevated-rails', '../factorio-data/elevated-rails');
engine.addMod('simple-seablock', '../simple-seablock/dist/SimpleSeablock');

engine.runSettingsPhase();

engine.runDataPhase();

//console.log(engine.getRawData());