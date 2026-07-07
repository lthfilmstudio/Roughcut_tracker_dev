import assert from 'node:assert/strict'
import test from 'node:test'
import { rangeKeys } from '../src/lib/selectionRange.ts'

const keys = ['1', '2', '3', '4A', '4B', '5']

test('selects the range from anchor down to the clicked key', () => {
  assert.deepEqual(rangeKeys(keys, '2', '4B'), ['2', '3', '4A', '4B'])
})

test('selects the range when clicking above the anchor', () => {
  assert.deepEqual(rangeKeys(keys, '5', '3'), ['3', '4A', '4B', '5'])
})

test('falls back to the clicked key when there is no anchor', () => {
  assert.deepEqual(rangeKeys(keys, null, '3'), ['3'])
})

test('falls back to the clicked key when the anchor is filtered out', () => {
  assert.deepEqual(rangeKeys(keys, '99', '3'), ['3'])
})

test('returns a single key when anchor and clicked are the same', () => {
  assert.deepEqual(rangeKeys(keys, '4A', '4A'), ['4A'])
})

test('falls back to the clicked key when the clicked key is not visible', () => {
  assert.deepEqual(rangeKeys(keys, '2', '99'), ['99'])
})
