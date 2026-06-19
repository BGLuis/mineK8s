#!/bin/bash

# Obtém o diretório absoluto onde este script está localizado (Cache Central / Source)
SOURCE_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

# Define o diretório de destino
TARGET_DIR="$1"

# Se o diretório não for passado como argumento, solicita ao usuário
if [ -z "$TARGET_DIR" ]; then
    read -p "Por favor, informe o caminho da pasta de destino: " TARGET_DIR
fi

# Verifica se o diretório foi informado
if [ -z "$TARGET_DIR" ]; then
    echo "Erro: Nenhum diretório informado."
    exit 1
fi

# Cria o diretório se não existir
if [ ! -d "$TARGET_DIR" ]; then
    echo "O diretório '$TARGET_DIR' não existe. Criando..."
    mkdir -p "$TARGET_DIR"
    chmod 777 "$TARGET_DIR"
else
    echo "O diretório '$TARGET_DIR' já existe."
fi

# Copia os arquivos
echo "Copiando arquivos de '$SOURCE_DIR' para '$TARGET_DIR' நான"

if [ -f "$SOURCE_DIR/download-server.sh" ]; then
    cp "$SOURCE_DIR/download-server.sh" "$TARGET_DIR/"

    # Modifica o script copiado para usar o cache centralizado
    # Substitui os caminhos de cache pelo caminho absoluto do SOURCE_DIR
    sed -i "s|CACHE_CONFIG_DIR=\"cache/config\"|CACHE_CONFIG_DIR=\"$SOURCE_DIR/cache/config\"|g" "$TARGET_DIR/download-server.sh"
    sed -i "s|CACHE_DIR=\"cache/jar\"|CACHE_DIR=\"$SOURCE_DIR/cache/jar\"|g" "$TARGET_DIR/download-server.sh"

    echo " > download-server.sh configurado com cache central."
else
    echo "Aviso: download-server.sh não encontrado em '$SOURCE_DIR'."
fi

if [ -f "$SOURCE_DIR/init-server.sh" ]; then
    cp "$SOURCE_DIR/init-server.sh" "$TARGET_DIR/"
else
    echo "Aviso: init-server.sh não encontrado em '$SOURCE_DIR'."
fi

# Cria um server.config vazio se não existir
if [ ! -f "$TARGET_DIR/server.config" ]; then
    touch "$TARGET_DIR/server.config"
    echo "Criado um arquivo 'server.config' vazio em '$TARGET_DIR'."
else
    echo "Arquivo 'server.config' já existe em '$TARGET_DIR'. Mantendo original."
fi

# Define permissão de execução para os scripts copiados
chmod +x "$TARGET_DIR/download-server.sh" 2>/dev/null
chmod +x "$TARGET_DIR/init-server.sh" 2>/dev/null

echo "Operação concluída com sucesso!"
echo "Para configurar seu servidor, vá para '$TARGET_DIR' e edite o arquivo server.config."
