import * as Joi from 'joi';

export const validationSchema = Joi.object({
	NODE_ENV: Joi.string()
		.valid('development', 'production', 'test')
		.default('development'),
	PORT: Joi.number().default(3000),
	JOIN_PORT: Joi.number().default(3001),
	BACKUPS_HOST_PATH: Joi.string().default('/var/minekube/backups'),
	DATABASE_URL: Joi.string().default('file:./dev.db'),
	CF_API_KEY: Joi.string().optional().allow(''),
	BASE_DOMAIN: Joi.string().default('mine.luiis.com.br'),
	TAILSCALE_TAILNET: Joi.string().default('-'),
	TAILSCALE_API_TOKEN: Joi.string().required(),
	TAILSCALE_FUNNEL_HOST: Joi.string().default('localhost:3001'),
});
