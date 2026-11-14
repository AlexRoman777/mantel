import { describe, expect, it, vi } from 'vitest';

vi.mock('$app/env/private', async () =>
	(await import('#lib/server/env.test-helper.js')).privateEnv({ DATA_DIR: '/tmp/mantel-trivia-test' })
);

const { buildFacts, formatPopulation, timezoneFor } = await import('./place-trivia');
const now = new Date('2026-09-04T10:00:00Z');
const home = { lat: 59.4449, lon: 18.0896, name: 'Täby Park, Täby' };

describe('place trivia facts', () => {
	it('builds the place ladder and facts for a photo taken in Iași', () => {
		const facts = buildFacts({ lat: 47.16, lon: 27.59, locationLabel: 'Iași, Romania', photoCount: 12, home, now });
		expect(facts.title).toBe('Iași');
		expect(facts.subtitle).toBe('Iasi, Romania');
		expect(facts.ladder.map((step) => `${step.level}:${step.name}`)).toEqual([
			'place:Iași', 'region:Iasi (county)', 'country:Romania', 'continent:Europe'
		]);
		expect(facts.timezone).toBe('Europe/Bucharest');
		expect(facts.localTime).toBe('13:00');
		expect(facts.sun).toEqual({ sunrise: '06:31', sunset: '19:46' });
		expect(facts.facts).toContain('Capital of Iasi');
		expect(facts.facts).toContain('326,000 people');
		expect(facts.facts).toContain('Romania: 19 million people · Eastern Europe');
		expect(facts.facts).toContain('1,501 km from Täby Park');
		expect(facts.facts).toContain('12 photos here');
	});

	it('names a spot outside any known place by its distance to the nearest one', () => {
		const facts = buildFacts({ lat: 59.44, lon: 18.07, locationLabel: 'Täby, Sweden', now });
		expect(facts.title).toBe('Täby');
		expect(facts.ladder[1]).toEqual({ level: 'region', name: 'Stockholm (county)' });
		expect(facts.facts).toContain('13 km from Stockholm (1.3 million people)');
	});

	it('recognises an island from the bundled outlines', () => {
		const facts = buildFacts({ lat: 37.75, lon: -25.67, locationLabel: 'Ponta Delgada, Portugal', now });
		expect(facts.ladder.some((step) => step.level === 'island' && step.name === 'Azores')).toBe(true);
		expect(facts.timezone).toBe('Atlantic/Azores');
	});

	it('falls back to coordinates and a longitude time zone in the middle of the ocean', () => {
		const facts = buildFacts({ lat: -40, lon: -30, now });
		expect(facts.place).toBeNull();
		expect(facts.ladder).toEqual([]);
		expect(facts.title).toBe('40.00° S, 30.00° W');
		expect(facts.timezone).toBe('Etc/GMT+2');
		expect(facts.facts.at(-1)).toBe('40.00° S, 30.00° W');
		expect(timezoneFor(59.44, 18.07)).toBe('Europe/Stockholm');
	});

	it('formats populations for reading at a glance', () => {
		expect(formatPopulation(1_942_000)).toBe('1.9 million people');
		expect(formatPopulation(325_914)).toBe('326,000 people');
		expect(formatPopulation(21_714)).toBe('22,000 people');
		expect(formatPopulation(2_340)).toBe('about 2,300 people');
		expect(formatPopulation(0)).toBe('');
	});
});
