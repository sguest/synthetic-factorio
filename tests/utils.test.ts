import { describe, expect, it } from 'vitest'
import { tableToArray } from '../src/utils';

describe('utils', () => {
    describe('tableToArray', () => {
        it('should convert an array-like table to an array', () => {
            const table = { 1: 'some-value', 2: 'some-other-value' };
            const result = tableToArray(table);
            expect(result).toEqual(['some-value', 'some-other-value']);
        });

        it('should support sparse values', () => {
            const table = { 1: 'some-value', 3: 'some-other-value' };
            const result = tableToArray(table);
            expect(result).toEqual(['some-value', undefined, 'some-other-value']);
        });


        it('should throw on non-numeric key', () => {
            const table = { foo: 'bar'};
            expect(() => tableToArray(table)).toThrow();
        })

        // Lua tables are 1-indexed, so keys are subtracted by 1 for indices and we don't expect 0
        it('should throw on zero key', () => {
            const table = { 0: 'some-value' };
            expect(() => tableToArray(table)).toThrow();
        })
    })
})