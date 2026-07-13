import { INestApplication } from '@nestjs/common';

export function configureCors(app: INestApplication): void {
	app.enableCors();
}
