#!/bin/bash
set -e

echo "Construindo a imagem Docker do Bot..."
cd bot
docker build -t minekube-bot:latest .

echo "Exportando a imagem..."
docker save minekube-bot:latest > bot.tar

echo "Importando a imagem para o k3s..."
sudo k3s ctr images import bot.tar
rm bot.tar

echo "Imagem importada com sucesso para o k3s containerd."
