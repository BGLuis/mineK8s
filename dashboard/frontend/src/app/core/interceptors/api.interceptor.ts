import { HttpInterceptorFn } from '@angular/common/http';

export const apiInterceptor: HttpInterceptorFn = (req, next) => {
	// Ignora chamadas que não começam com /api
	if (!req.url.startsWith('/api')) {
		return next(req);
	}

	// Pega a URL dinâmica do window.__env ou faz fallback pro default
	const apiUrl = (window as any).__env?.apiUrl || 'http://localhost:3000';

	const apiReq = req.clone({
		url: `${apiUrl}${req.url}`,
	});

	return next(apiReq);
};
