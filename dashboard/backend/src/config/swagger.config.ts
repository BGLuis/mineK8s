import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export function configureSwagger(app: INestApplication) {
	const config = new DocumentBuilder()
		.setTitle('MineKube API')
		.setDescription(
			'API para gerenciamento de servidores Minecraft no Kubernetes',
		)
		.setVersion('1.0')
		.addBearerAuth(
			{
				type: 'http',
				scheme: 'bearer',
				bearerFormat: 'JWT',
				name: 'JWT',
				description: 'Enter JWT token',
				in: 'header',
			},
			'jwt',
		)
		.addTag('Servers', 'Gerenciamento dos servidores de Minecraft')
		.addTag('Modpacks', 'Gerenciamento de modpacks (CurseForge e Modrinth)')
		.addTag('Backups', 'Gerenciamento de backups dos servidores')
		.addTag('Gateway', 'Monitoramento e gerenciamento do Gateway TCP')
		.addTag('Tailscale', 'Gerenciamento de convites e acesso via Tailscale')
		.addTag('Admin', 'Configurações de administração')
		.build();

	const document = SwaggerModule.createDocument(app, config);

	SwaggerModule.setup('api/docs', app, document, {
		swaggerOptions: {
			persistAuthorization: true,
			tagsSorter: 'alpha',
			operationsSorter: 'alpha',
			docExpansion: 'none',
			filter: true,
			tryItOutEnabled: true,
		},
		customSiteTitle: 'MineKube API Documentation',
	});
}
