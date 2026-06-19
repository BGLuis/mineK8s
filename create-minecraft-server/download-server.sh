#!/bin/bash

# Garante que o script execute no diretório onde ele está localizado
cd "$(dirname "$0")"

CONFIG_FILE="server.config"

# Modpack / Custom Script Detection
if [ -f "startserver.sh" ]; then
    echo "Script de inicialização 'startserver.sh' detectado."
    TYPE="CUSTOM"
    VERSION="custom"
    
    # --- Configurações Padrão via Cache (CUSTOM) ---
    CACHE_CONFIG_DIR="cache/config"
    mkdir -p "$CACHE_CONFIG_DIR"
    CACHE_CONFIG_FILE="$CACHE_CONFIG_DIR/$TYPE.config"

    if [ ! -f "$CACHE_CONFIG_FILE" ]; then
        echo "Criando modelo de configuração padrão em $CACHE_CONFIG_FILE..."
        echo "MIN_RAM=4G" > "$CACHE_CONFIG_FILE"
        echo "MAX_RAM=8G" >> "$CACHE_CONFIG_FILE"
        echo 'SERVER_ARGS=""' >> "$CACHE_CONFIG_FILE"
        echo 'JAVA_ARGS=""' >> "$CACHE_CONFIG_FILE"
    fi
    
    # Cria server.config
    echo "Gerando server.config para modpack..."
    echo "VERSION=$VERSION" > "$CONFIG_FILE"
    echo "TYPE=$TYPE" >> "$CONFIG_FILE"
    
    # Mescla defaults
    while IFS= read -r line; do
        echo "$line" >> "$CONFIG_FILE"
    done < "$CACHE_CONFIG_FILE"

    # Define JAR_PATH como o script
    JAR_PATH="./startserver.sh"
    echo "JAR_PATH=$JAR_PATH" >> "$CONFIG_FILE"
    # -----------------------------------------------
    
    # EULA
    if [ ! -f "eula.txt" ]; then
        echo "eula=true" > eula.txt
        echo "eula.txt criado."
    fi

    # Permission
    chmod +x startserver.sh

    echo "Tentando detectar variável de instalação (INSTALL_ONLY)..."
    # Busca dinâmica por variáveis como ATM10_INSTALL_ONLY, INSTALL_ONLY, etc.
    INSTALL_VAR=$(grep -oE "[A-Z0-9_]*INSTALL_ONLY" startserver.sh | head -n 1)
    
    if [ -n "$INSTALL_VAR" ]; then
        echo "Variável detectada: $INSTALL_VAR"
        export $INSTALL_VAR=true
        ./startserver.sh
    else
        echo "Aviso: Nenhuma variável de instalação 'only' detectada no script."
        echo "Executando o script normalmente. Pressione Ctrl+C se o servidor iniciar e você quiser apenas instalar."
        ./startserver.sh
    fi
    
    echo "Instalação concluída. Use ./init-server.sh para iniciar."
    exit 0
fi

# FTB / Custom Install Script Detection
if [ -f "install.sh" ]; then
    echo "Script de instalação 'install.sh' detectado (Padrão FTB)."
    TYPE="CUSTOM"
    VERSION="custom"
    
    # --- Configurações Padrão via Cache (CUSTOM) ---
    CACHE_CONFIG_DIR="cache/config"
    mkdir -p "$CACHE_CONFIG_DIR"
    CACHE_CONFIG_FILE="$CACHE_CONFIG_DIR/$TYPE.config"

    if [ ! -f "$CACHE_CONFIG_FILE" ]; then
        echo "Criando modelo de configuração padrão em $CACHE_CONFIG_FILE..."
        echo "MIN_RAM=4G" > "$CACHE_CONFIG_FILE"
        echo "MAX_RAM=8G" >> "$CACHE_CONFIG_FILE"
        echo 'SERVER_ARGS=""' >> "$CACHE_CONFIG_FILE"
        echo 'JAVA_ARGS=""' >> "$CACHE_CONFIG_FILE"
    fi
    
    # Cria server.config
    echo "Gerando server.config para modpack..."
    echo "VERSION=$VERSION" > "$CONFIG_FILE"
    echo "TYPE=$TYPE" >> "$CONFIG_FILE"
    
    # Mescla defaults
    while IFS= read -r line; do
        echo "$line" >> "$CONFIG_FILE"
    done < "$CACHE_CONFIG_FILE"
    
    # EULA
    if [ ! -f "eula.txt" ]; then
        echo "eula=true" > eula.txt
        echo "eula.txt criado."
    fi

    chmod +x install.sh
    echo "Executando script de download do instalador..."
    ./install.sh
    
    # Encontra o binário que acabou de ser baixado
    # O script instala algo como ftb-server-installer_ID_VER
    INSTALLER_BIN=$(find . -maxdepth 1 -name "ftb-server-installer*" -type f -executable | sort -V | tail -n 1)
    
    if [ -n "$INSTALLER_BIN" ]; then
        echo "Instalador encontrado: $INSTALLER_BIN"
        echo "Executando instalador do servidor (Forçando instalação)..."
        # Usa --force para ignorar avisos de diretório não vazio
        "$INSTALLER_BIN" --auto --force
        
        # Tenta encontrar o script de inicialização gerado
        # Busca por start.sh, run.sh ou ServerStart.sh (comum em FTB antigo)
        START_SCRIPT=$(find . -maxdepth 1 \( -name "start.sh" -o -name "run.sh" -o -name "ServerStart.sh" \) -type f -executable | head -n 1)
        
        # Se não achou executável, tenta achar qualquer arquivo com esses nomes (as vezes vem sem permissão de execução)
        if [ -z "$START_SCRIPT" ]; then
             START_SCRIPT=$(find . -maxdepth 1 \( -name "start.sh" -o -name "run.sh" -o -name "ServerStart.sh" \) -type f | head -n 1)
             if [ -n "$START_SCRIPT" ]; then
                 echo "Script encontrado sem permissão de execução: $START_SCRIPT"
                 chmod +x "$START_SCRIPT"
             fi
        fi
        
        if [ -n "$START_SCRIPT" ]; then
            JAR_PATH="./$START_SCRIPT"
            echo "Script de inicialização detectado: $JAR_PATH"
            echo "JAR_PATH=$JAR_PATH" >> "$CONFIG_FILE"
        else
            echo "Erro: Não foi possível encontrar o script de inicialização (start.sh/run.sh)."
            echo "Por favor, verifique os arquivos e configure JAR_PATH no server.config manualmente."
        fi
    else
        echo "Erro: O binário do instalador (ftb-server-installer) não foi encontrado após rodar install.sh."
    fi

    echo "Processo de instalação finalizado. Use ./init-server.sh para iniciar."
    exit 0
fi

# Verifica se o arquivo de configuração existe e carrega as variáveis
if [ -f "$CONFIG_FILE" ]; then
    echo "Lendo configuração de $CONFIG_FILE..."
    source "$CONFIG_FILE"
fi

# Se a versão não foi carregada do arquivo, verifica argumento ou pede input
if [ -z "$VERSION" ]; then
    VERSION=$1
    if [ -z "$VERSION" ]; then
        echo "Arquivo de configuração não encontrado."
        echo "Por favor, informe a versão do Minecraft (ex: 1.20.1):"
        read VERSION
    fi
    
    # Default TYPE if not set
    if [ -z "$TYPE" ]; then
        TYPE="VANILLA"
    fi

    echo "Criando $CONFIG_FILE com a versão do Minecraft..."
    echo "VERSION=$VERSION" > "$CONFIG_FILE"
    echo "TYPE=$TYPE" >> "$CONFIG_FILE"
    # Se MOD_LOADER_VERSION foi definido externamente, salva também
    if [ -n "$MOD_LOADER_VERSION" ]; then
        echo "MOD_LOADER_VERSION=$MOD_LOADER_VERSION" >> "$CONFIG_FILE"
    fi
    echo "Arquivo $CONFIG_FILE criado com sucesso."
else
    echo "Versão detectada: $VERSION"
    if [ -z "$TYPE" ]; then
        TYPE="VANILLA"
        echo "TYPE não encontrado, definindo como VANILLA."
        echo "TYPE=$TYPE" >> "$CONFIG_FILE"
    else
        echo "Tipo detectado: $TYPE"
    fi
    if [ -n "$MOD_LOADER_VERSION" ]; then
        echo "Loader Version: $MOD_LOADER_VERSION"
    fi
fi

# --- Lógica de Pré-Resolução para Forge (para definir o nome do cache corretamente) ---
if [ "$TYPE" == "FORGE" ] && [ -z "$MOD_LOADER_VERSION" ]; then
    echo "Detectando versão mais recente do Forge para $VERSION..."
    PROMOS_URL="https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json"
    PROMOS_DATA=$(curl -s "$PROMOS_URL")
    
    # Extrai a versão 'latest' usando regex que tolera espaços
    # Padrão: "VERSION-latest": "FORGE_VERSION"
    FORGE_VERSION=$(echo "$PROMOS_DATA" | grep "\"$VERSION-latest\"" | cut -d'"' -f4)
    
    if [ -z "$FORGE_VERSION" ]; then
        echo "Erro: Versão do Forge não encontrada para Minecraft $VERSION."
        exit 1
    fi
    
    MOD_LOADER_VERSION="$FORGE_VERSION"
    echo "Forge Latest encontrado: $MOD_LOADER_VERSION"
    
    # Salva no config para persistência
    if grep -q '^MOD_LOADER_VERSION=' "$CONFIG_FILE"; then
        sed -i "s/^MOD_LOADER_VERSION=.*/MOD_LOADER_VERSION=$MOD_LOADER_VERSION/" "$CONFIG_FILE"
    else
        echo "MOD_LOADER_VERSION=$MOD_LOADER_VERSION" >> "$CONFIG_FILE"
    fi
fi

# --- Lógica de Pré-Resolução para NeoForge ---
if [ "$TYPE" == "NEOFORGE" ] && [ -z "$MOD_LOADER_VERSION" ]; then
    echo "Detectando versão mais recente do NeoForge para $VERSION..."
    # A API Maven retorna XML. Vamos buscar as versões disponíveis.
    METADATA_URL="https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge"
    METADATA_JSON=$(curl -s "$METADATA_URL")
    
    # NeoForge versions usually match MC versions or subsets.
    # Ex: 21.0.0-beta for 1.21.
    # Filtra versões que começam ou contém a versão do MC, ou tenta inferir (ex: 1.21 -> 21.)
    # Para simplificar, vamos tentar encontrar versões que contenham a string da versão do MC
    # Se falhar, tenta o mapeamento "short" (1.20.4 -> 20.4)
    
    # Pega todas as versões do JSON (versions: ["x", "y"])
    # Limpa json, tr para nova linha, filtra.
    
    # Tenta filtro direto (ex: 1.20.1-...)
    NEO_VERSION=$(echo "$METADATA_JSON" | grep -o '"versions":\[.*\]' | sed 's/"versions":\[//;s/\]//;s/"//g' | tr ',' '\n' | grep "^$VERSION" | sort -V | tail -n 1)
    
    # Se falhar, tenta lógica de versões novas do NeoForge (ex: 1.21 -> 21.x)
    if [ -z "$NEO_VERSION" ]; then
        # Remove '1.' do inicio da versao (1.21 -> 21)
        SHORT_MC_VER=$(echo "$VERSION" | sed 's/^1\.//')
        NEO_VERSION=$(echo "$METADATA_JSON" | grep -o '"versions":\[.*\]' | sed 's/"versions":\[//;s/\]//;s/"//g' | tr ',' '\n' | grep "^${SHORT_MC_VER}\." | sort -V | tail -n 1)
    fi

    if [ -z "$NEO_VERSION" ]; then
        echo "Erro: Versão do NeoForge não encontrada automaticamente para Minecraft $VERSION."
        echo "Você pode definir MOD_LOADER_VERSION manualmente no server.config."
        exit 1
    fi
    
    MOD_LOADER_VERSION="$NEO_VERSION"
    echo "NeoForge Latest encontrado: $MOD_LOADER_VERSION"
    
    if grep -q '^MOD_LOADER_VERSION=' "$CONFIG_FILE"; then
        sed -i "s/^MOD_LOADER_VERSION=.*/MOD_LOADER_VERSION=$MOD_LOADER_VERSION/" "$CONFIG_FILE"
    else
        echo "MOD_LOADER_VERSION=$MOD_LOADER_VERSION" >> "$CONFIG_FILE"
    fi
fi

# --- Lógica de Pré-Resolução para Fabric ---
if [ "$TYPE" == "FABRIC" ] && [ -z "$MOD_LOADER_VERSION" ]; then
    echo "Detectando versão mais recente do Fabric Loader para $VERSION..."
    
    # Busca loaders compatíveis com a versão do jogo
    LOADER_META_URL="https://meta.fabricmc.net/v2/versions/loader/$VERSION"
    LOADER_DATA=$(curl -s "$LOADER_META_URL")
    
    # O JSON retorna uma lista, o primeiro é o mais recente estável
    # [{"loader":{"version":"0.15.11"}, ...}]
    # Regex ajustado para aceitar espaços após os dois pontos
    LOADER_VERSION=$(echo "$LOADER_DATA" | grep -o '"version": *"[^"]*"' | head -n 1 | cut -d'"' -f4)
    
    if [ -z "$LOADER_VERSION" ]; then
        echo "Erro: Nenhum Fabric Loader encontrado para a versão $VERSION."
        exit 1
    fi
    
    MOD_LOADER_VERSION="$LOADER_VERSION"
    echo "Fabric Loader encontrado: $MOD_LOADER_VERSION"
    
    if grep -q '^MOD_LOADER_VERSION=' "$CONFIG_FILE"; then
        sed -i "s/^MOD_LOADER_VERSION=.*/MOD_LOADER_VERSION=$MOD_LOADER_VERSION/" "$CONFIG_FILE"
    else
        echo "MOD_LOADER_VERSION=$MOD_LOADER_VERSION" >> "$CONFIG_FILE"
    fi
fi

# --- Configurações Padrão via Cache ---
CACHE_CONFIG_DIR="cache/config"
mkdir -p "$CACHE_CONFIG_DIR"
CACHE_CONFIG_FILE="$CACHE_CONFIG_DIR/$TYPE.config"

if [ ! -f "$CACHE_CONFIG_FILE" ]; then
    echo "Criando modelo de configuração padrão em $CACHE_CONFIG_FILE..."
    echo "MIN_RAM=2G" > "$CACHE_CONFIG_FILE"
    echo "MAX_RAM=4G" >> "$CACHE_CONFIG_FILE"
    echo 'SERVER_ARGS="nogui"' >> "$CACHE_CONFIG_FILE"
    
    if [ "$TYPE" == "PAPER" ] || [ "$TYPE" == "FABRIC" ]; then
        echo 'JAVA_ARGS="-XX:+UseG1GC -Dfile.encoding=UTF-8"' >> "$CACHE_CONFIG_FILE"
    elif [ "$TYPE" == "FORGE" ] || [ "$TYPE" == "NEOFORGE" ]; then
        echo 'JAVA_ARGS="-XX:+UseG1GC"' >> "$CACHE_CONFIG_FILE"
    else
        echo 'JAVA_ARGS="-XX:+UseG1GC"' >> "$CACHE_CONFIG_FILE"
    fi
fi

echo "Verificando configurações padrão..."
while IFS= read -r line; do
    key=$(echo "$line" | cut -d'=' -f1)
    if ! grep -q "^$key=" "$CONFIG_FILE"; then
        echo "Adicionando configuração padrão: $line"
        echo "$line" >> "$CONFIG_FILE"
    fi
done < "$CACHE_CONFIG_FILE"
# ---------------------------------------------------

# Configuração do Cache
CACHE_DIR="cache/jar"
mkdir -p "$CACHE_DIR"

# Constrói o nome do arquivo. Se tiver MOD_LOADER_VERSION, inclui no nome.
if [ -n "$MOD_LOADER_VERSION" ]; then
    FILENAME_SUFFIX="${TYPE}-${VERSION}-${MOD_LOADER_VERSION}"
else
    FILENAME_SUFFIX="${TYPE}-${VERSION}"
fi

CACHE_JAR="$CACHE_DIR/server-${FILENAME_SUFFIX}.jar"
SERVER_JAR="server-${FILENAME_SUFFIX}.jar"

# Verifica se está em cache
if [ -f "$CACHE_JAR" ]; then
    echo "Encontrado no cache: $CACHE_JAR"
    echo "Copiando para o diretório atual..."
    cp "$CACHE_JAR" "$SERVER_JAR"
    
    JAR_PATH="./$SERVER_JAR"
    sed -i '/^JAR_PATH=/d' "$CONFIG_FILE"
    echo "JAR_PATH=$JAR_PATH" >> "$CONFIG_FILE"
    
    echo "Concluído: $SERVER_JAR"
    exit 0
fi

echo "Buscando informações para download..."

SERVER_JAR_URL=""

if [ "$TYPE" == "VANILLA" ]; then
    MANIFEST_URL="https://launchermeta.mojang.com/mc/game/version_manifest.json"
    MANIFEST_DATA=$(curl -s "$MANIFEST_URL")
    # Regex ajustado: aspas duplas para expandir $VERSION e correção no sed
    VERSION_URL=$(echo "$MANIFEST_DATA" | jq -r ".versions[] | select(.id == \"$VERSION\") | .url")

    if [ -z "$VERSION_URL" ]; then
        echo "Erro: Versão '$VERSION' não encontrada no manifesto Mojang."
        exit 1
    fi

    VERSION_DATA=$(curl -s "$VERSION_URL")
    # Regex ajustado para extração do server jar
    SERVER_JAR_URL=$(echo "$VERSION_DATA" | jq -r '.downloads.server.url')

elif [ "$TYPE" == "PAPER" ]; then
    PROJECT_URL="https://api.papermc.io/v2/projects/paper/versions/$VERSION"
    PROJECT_DATA=$(curl -s "$PROJECT_URL")
    
    if echo "$PROJECT_DATA" | grep -q "error"; then
        echo "Erro: Versão '$VERSION' não encontrada na API do PaperMC."
        exit 1
    fi

    LATEST_BUILD=$(echo "$PROJECT_DATA" | jq -r '.builds[-1]')

    if [ -z "$LATEST_BUILD" ]; then
        echo "Erro: Não foi possível encontrar builds para a versão $VERSION."
        exit 1
    fi
    
    SERVER_JAR_URL="https://api.papermc.io/v2/projects/paper/versions/$VERSION/builds/$LATEST_BUILD/downloads/paper-$VERSION-$LATEST_BUILD.jar"

elif [ "$TYPE" == "FORGE" ]; then
    # Já resolvemos a versão lá em cima, apenas usamos aqui
    echo "Usando versão do Forge: $MOD_LOADER_VERSION"
    SERVER_JAR_URL="https://maven.minecraftforge.net/net/minecraftforge/forge/${VERSION}-${MOD_LOADER_VERSION}/forge-${VERSION}-${MOD_LOADER_VERSION}-installer.jar"

    # Validação: Verifica se o arquivo realmente existe no servidor do Forge
    echo "Verificando se a versão existe..."
    if ! curl --output /dev/null --silent --head --fail -L "$SERVER_JAR_URL"; then
        echo "Erro: A versão do Forge '$MOD_LOADER_VERSION' não parece ser válida para Minecraft '$VERSION'."
        echo "URL testada: $SERVER_JAR_URL"
        echo "Verifique se o 'MOD_LOADER_VERSION' no server.config está correto."
        exit 1
    fi

elif [ "$TYPE" == "NEOFORGE" ]; then
    echo "Usando versão do NeoForge: $MOD_LOADER_VERSION"
    SERVER_JAR_URL="https://maven.neoforged.net/releases/net/neoforged/neoforge/${MOD_LOADER_VERSION}/neoforge-${MOD_LOADER_VERSION}-installer.jar"

    echo "Verificando se a versão existe..."
    if ! curl --output /dev/null --silent --head --fail -L "$SERVER_JAR_URL"; then
        echo "Erro: A versão do NeoForge '$MOD_LOADER_VERSION' não parece ser válida."
        echo "URL testada: $SERVER_JAR_URL"
        exit 1
    fi

elif [ "$TYPE" == "FABRIC" ]; then
    echo "Usando Fabric Loader: $MOD_LOADER_VERSION"
    
    # Busca a versão mais recente do Instalador
    INSTALLER_META_URL="https://meta.fabricmc.net/v2/versions/installer"
    # Regex ajustado para aceitar espaços
    INSTALLER_VERSION=$(curl -s "$INSTALLER_META_URL" | grep -o '"version": *"[^"]*"' | head -n 1 | cut -d'"' -f4)
    
    if [ -z "$INSTALLER_VERSION" ]; then
        echo "Erro: Não foi possível detectar a versão do Instalador Fabric."
        exit 1
    fi
    
    # A API do Fabric gera um JAR de servidor executável diretamente
    SERVER_JAR_URL="https://meta.fabricmc.net/v2/versions/loader/${VERSION}/${MOD_LOADER_VERSION}/${INSTALLER_VERSION}/server/jar"
    
    echo "Verificando endpoint do Fabric..."
    if ! curl --output /dev/null --silent --head --fail -L "$SERVER_JAR_URL"; then
        echo "Erro: Não foi possível gerar o JAR do Fabric."
        echo "URL testada: $SERVER_JAR_URL"
        exit 1
    fi

else
    echo "Erro: O tipo '$TYPE' ainda não é suportado."
    exit 1
fi

if [ -z "$SERVER_JAR_URL" ]; then
    echo "Erro: Falha ao obter a URL de download."
    exit 1
fi

echo "Baixando para o cache: $CACHE_JAR..."
curl -# -L -o "$CACHE_JAR" "$SERVER_JAR_URL"

JAR_PATH="./$SERVER_JAR"
sed -i '/^JAR_PATH=/d' "$CONFIG_FILE"
echo "JAR_PATH=$JAR_PATH" >> "$CONFIG_FILE"

echo "Download e instalação concluídos: $SERVER_JAR"