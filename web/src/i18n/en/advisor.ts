import type { advisor as es } from '../es/advisor';

export const advisor: Record<keyof typeof es, string> = {
  'advisor.title': 'What to do first',
  'advisor.subtitle': 'The findings of Sensors and Network, ranked by urgency. Each recommendation cites the finding behind it.',
  'advisor.loading': 'Preparing the recommendations…',
  'advisor.error': 'We could not prepare the recommendations.',
  'advisor.retry': 'Retry',
  'advisor.empty': 'Nothing is urgent: the findings are in order.',
  'advisor.source.rules': 'Ranked by rules',
  'advisor.source.ai': 'Written with AI and checked against the data',
  'advisor.ai.ask': 'Write with AI',
  'advisor.ai.asking': 'Writing…',
  'advisor.fallback.unavailable': 'The AI is not configured on this machine; the rules are shown.',
  'advisor.fallback.error': 'We could not reach the AI; the rules are shown.',
  'advisor.fallback.invalid': 'The AI answer did not match the data and was discarded; the rules are shown.',
  'advisor.fallback.limit': 'Several AI requests were already made this minute; wait a moment. The rules are shown.',
  'advisor.item.why': 'Why:',
  'advisor.item.action': 'What to do:',
  'advisor.item.evidence': 'Evidence:',
  'advisor.open.sensors': 'Open Sensors',
  'advisor.open.network': 'Open Network',
  'advisor.note': 'It is an aid, not an order: check the figures against the evidence before deciding.',
};
