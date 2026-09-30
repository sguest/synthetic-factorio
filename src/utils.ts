/**
 * Many parts of the Factorio API return tables for array/list-like data
 * i.e. { 1: 'some-value', 2: 'some-other-value' } instead of ['some-value', 'some-other-value']
 * This function will convert them to a proper array
 * @param table Array-like table from lua
 * @returns Input table converted to a proper array
 */
export function tableToArray<T>(table: {[key: number]: T}): T[]
{
    const result: T[] = [];
    for(const key in table) {
        const index = parseInt(key) - 1;
        if(isNaN(index)) {
            throw new Error(`Failed to convert table to array, found non-numeric key ${key}`);
        }
        if(index < 0) {
            throw new Error(`Failed to convert table to array, found key ${key} less than 1`);
        }
        result[index] = table[key];
    }

    return result;
}