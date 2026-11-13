import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/** The Player entry point immediately joins the default presentation. */
export const load: PageServerLoad = () => redirect(307, '/display/auto');
