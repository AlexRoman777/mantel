import { error, json } from '@sveltejs/kit';
import { getSchoolMeals } from '#lib/server/school-meals.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const school = url.searchParams.get('school') ?? '';
	if (!/^[a-z0-9-]{1,100}$/.test(school)) error(400, 'Invalid school slug');
	return json(await getSchoolMeals(school), {
		headers: { 'Cache-Control': 'public, max-age=900, stale-while-revalidate=3600' }
	});
};
