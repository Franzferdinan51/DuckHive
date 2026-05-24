import { expect, test } from 'bun:test'

import { getCompactUserSummaryMessage } from './prompt.js'

test('compact resume summary tells the model newer preserved messages override older work', () => {
  const message = getCompactUserSummaryMessage(
    'Summary:\n7. Pending Tasks:\n- Keep fixing the old provider issue.',
    true,
    undefined,
    true,
  )

  expect(message).toContain('Recent messages are preserved verbatim')
  expect(message).toContain('newer than this summary')
  expect(message).toContain('use the newest user request as the active task')
  expect(message).toContain('marked fixed, complete, canceled, or lower priority')
})
