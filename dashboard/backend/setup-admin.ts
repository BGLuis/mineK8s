import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { PrismaService } from './src/prisma/prisma.service';

async function main() {
	const app = await NestFactory.createApplicationContext(AppModule);
	const prisma = app.get(PrismaService);

	const email = 'luishenrique.gbarbosa21@gmail.com';

	console.log(`Buscando ou criando o usuário: ${email}`);

	let user = await prisma.user.findUnique({
		where: { tailscaleUserId: email },
	});

	if (!user) {
		user = await prisma.user.create({
			data: {
				tailscaleUserId: email,
				email: email,
				minecraftNick: 'Luis_Admin',
				role: 'ADMIN',
			},
		});
		console.log('✅ Usuário criado:', user);
	} else {
		console.log('✅ Usuário já existe:', user);
	}

	// Criar grupo master caso não exista
	let group = await prisma.group.findUnique({
		where: { name: 'Admin Master' },
	});

	if (!group) {
		group = await prisma.group.create({
			data: {
				name: 'Admin Master',
				description: 'Grupo com acesso a todos os servidores',
			},
		});
		console.log('✅ Grupo Admin Master criado:', group);
	}

	// Vincular o usuário ao grupo
	const userGroup = await prisma.userGroup.findUnique({
		where: {
			userId_groupId: {
				userId: user.id,
				groupId: group.id,
			},
		},
	});

	if (!userGroup) {
		await prisma.userGroup.create({
			data: {
				userId: user.id,
				groupId: group.id,
			},
		});
		console.log('✅ Usuário vinculado ao grupo Admin Master');
	} else {
		console.log('✅ Usuário já estava vinculado ao grupo Admin Master');
	}

	// Buscar todos os servidores e vincular ao grupo Master
	const servers = await prisma.server.findMany();
	let count = 0;
	for (const server of servers) {
		const sg = await prisma.serverGroup.findUnique({
			where: {
				serverId_groupId: {
					serverId: server.id,
					groupId: group.id,
				},
			},
		});

		if (!sg) {
			await prisma.serverGroup.create({
				data: {
					serverId: server.id,
					groupId: group.id,
				},
			});
			count++;
		}
	}

	console.log(`✅ ${count} servidores vinculados ao grupo Admin Master.`);
	await app.close();
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
