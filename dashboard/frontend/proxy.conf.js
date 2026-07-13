const BACKEND_PORT = process.env.BACKEND_PORT || 3000;

module.exports = {
	'/api': {
		target: `http://localhost:${BACKEND_PORT}`,
		secure: false,
		changeOrigin: true,
		logLevel: 'warn',
	},
};
