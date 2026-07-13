import { HttpInterceptorFn } from '@angular/common/http';
import { environment } from '../../../environments/environment';

export const apiInterceptor: HttpInterceptorFn = (req, next) => {
	// Ignora chamadas que não começam com /api
	if (!req.url.startsWith('/api')) {
		return next(req);
	}

	const apiReq = req.clone({
		url: `${environment.apiUrl}${req.url}`,
	});

	return next(apiReq);
};
