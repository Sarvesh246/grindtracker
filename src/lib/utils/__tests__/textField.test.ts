import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isTextField } from '../textField'

describe('isTextField', () => {
  it('rejects null and non-elements', () => {
    assert.equal(isTextField(null), false)
    assert.equal(isTextField({} as EventTarget), false)
  })
})
