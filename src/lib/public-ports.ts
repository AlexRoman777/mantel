import { env } from '$env/dynamic/public';

export const playerPublicPort = env.PUBLIC_PLAYER_PORT || '3830';
export const controllerPublicPort = env.PUBLIC_CONTROL_PORT || '3831';
