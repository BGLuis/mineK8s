#!/bin/bash
export SERVICE_MODE=true
echo "eula=true" > eula.txt
cp server.config.example server.config
echo "Fazendo o download inicial do servidor..."
./download-server.sh
echo "Iniciando o servidor..."
exec ./init-server.sh
