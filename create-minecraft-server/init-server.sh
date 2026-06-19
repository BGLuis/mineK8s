#!/bin/bash

# Garante que o script execute no diretório onde ele está localizado
cd "$(dirname "$0")"

CONFIG_FILE="server.config"

if [ ! -f "$CONFIG_FILE" ]; then
    echo "Erro: $CONFIG_FILE não encontrado. Execute ./download-server.sh primeiro."
    exit 1
fi

echo "Carregando configurações de $CONFIG_FILE..."
source "$CONFIG_FILE"

# Validações básicas
if [ -z "$JAR_PATH" ]; then
    echo "Erro: JAR_PATH não definido em $CONFIG_FILE."
    exit 1
fi

# Garante que os valores de memória e args tenham defaults caso o config esteja incompleto
MIN_RAM=${MIN_RAM:-"2G"}
MAX_RAM=${MAX_RAM:-"4G"}
SERVER_ARGS=${SERVER_ARGS:-"nogui"}
JAVA_ARGS=${JAVA_ARGS:-"-XX:+UseG1GC"}

# Aceitar EULA automaticamente (necessário para rodar)
if [ ! -f "eula.txt" ]; then
    echo "eula=true" > eula.txt
    echo "Arquivo eula.txt criado (EULA aceito)."
fi

# --- Gerenciamento de Sessão (Screen) ---
SESSION_NAME="mc-server"
CMD_PREFIX=""

# Só tenta usar screen se NÃO estivermos no modo serviço
if [ -z "$SERVICE_MODE" ]; then

    if command -v screen &> /dev/null; then
        # Verifica se a sessão já existe
        if screen -list | grep -q "\.${SESSION_NAME}"; then
            echo "Servidor já está rodando na sessão '$SESSION_NAME'."
            echo "Conectando ao console... (Use 'Ctrl+A, D' para sair sem parar o servidor)"
            sleep 2
            exec screen -x "$SESSION_NAME"
        fi

        echo "Iniciando nova sessão 'screen' para o servidor..."
        # Define o prefixo para rodar dentro do screen
        # Usa 'bash -c' para permitir comandos compostos (pause no final)
        CMD_PREFIX="screen -S $SESSION_NAME bash -c"
    else
        echo "Aviso: 'screen' não instalado."
        echo "O servidor rodará em primeiro plano. Se fechar este terminal, o servidor irá parar."

        # Tenta detectar se já está rodando sem screen (apenas check simples)
        if pgrep -f "$(basename "$JAR_PATH")" > /dev/null; then
            echo "AVISO: Parece que o servidor já está rodando em outro processo."
            echo "Continuar pode causar corrupção de dados. Pressione Ctrl+C para cancelar em 5 segundos."
            sleep 5
        fi
    fi
fi

# Verifica se Java está instalado
if ! command -v java &> /dev/null; then
    echo "Erro: Java não encontrado. Instale o JDK (versão 17 ou 21+ recomendada)."
    exit 1
fi

# --- Lógica Especial para FORGE e NEOFORGE ---
if [ "$TYPE" == "FORGE" ] || [ "$TYPE" == "NEOFORGE" ]; then
    echo "Detectado ambiente $TYPE."

    # 1. Instalação
    # O JAR_PATH aponta para o instalador. Precisamos instalar se as bibliotecas não existirem.
    if [ ! -d "libraries" ]; then
        echo "Bibliotecas não encontradas. Iniciando instalação do servidor..."
        # Instalação roda sem screen (foreground) pois é setup único
        echo "Executando: java -jar $(basename "$JAR_PATH") --installServer"
        java -jar "$JAR_PATH" --installServer

        if [ $? -ne 0 ]; then
            echo "Erro crítico na instalação do $TYPE."
            exit 1
        fi
        echo "Instalação concluída com sucesso."
    fi

    # 2. Inicialização
    # Versões modernas (1.17+) usam run.sh e user_jvm_args.txt
    if [ -f "run.sh" ]; then
        echo "Script de inicialização nativo (run.sh) detectado."
        chmod +x run.sh

        # Injeta as configurações de memória e Java no arquivo de argumentos do Forge
        ARGS_FILE="user_jvm_args.txt"
        echo "# Gerado por init-server.sh" > "$ARGS_FILE"
        echo "-Xms${MIN_RAM}" >> "$ARGS_FILE"
        echo "-Xmx${MAX_RAM}" >> "$ARGS_FILE"
        # Adiciona argumentos Java extras (quebrando linha por espaço se houver múltiplos)
        echo "${JAVA_ARGS}" | xargs -n1 >> "$ARGS_FILE"

        echo "Iniciando servidor via ./run.sh..."

        if [ -n "$CMD_PREFIX" ]; then
            # Executa dentro do screen com pausa no final
            exec $CMD_PREFIX "./run.sh $SERVER_ARGS || { echo 'Servidor crashou ou parou.'; read -p 'Pressione Enter para fechar...' ; }"
        else
            exec ./run.sh "$SERVER_ARGS"
        fi
    else
        # Fallback para versões antigas (Pre-1.17)
        # Tenta encontrar o jar universal ou server gerado
        UNIVERSAL_JAR=$(find . -maxdepth 1 -name "forge-*-universal.jar" -o -name "forge-*-server.jar" | head -n 1)

        if [ -n "$UNIVERSAL_JAR" ]; then
            echo "Jar universal detectado: $UNIVERSAL_JAR"
            # Atualiza a variável JAR_PATH para apontar para o jar correto de execução, não o instalador
            JAR_PATH="./$UNIVERSAL_JAR"
        else
            echo "Aviso: Não foi possível encontrar 'run.sh' nem um jar universal."
            echo "Tentando executar o arquivo original (pode falhar se for apenas instalador)..."
        fi
    fi
fi

# --- Execução Padrão (Vanilla, Paper, Fabric, Legacy Forge, Custom Scripts) ---
echo "Iniciando servidor..."
echo " > Arquivo: $JAR_PATH"
echo " > Memória (para Jars gerenciados): $MIN_RAM - $MAX_RAM"

# Verifica se é um script shell (.sh) ou um JAR (.jar)
if [[ "$JAR_PATH" == *.sh ]]; then
    echo "Detectado script de inicialização personalizado."
    chmod +x "$JAR_PATH"

    if [ -n "$CMD_PREFIX" ]; then
        # Executa script dentro do screen
        exec $CMD_PREFIX "$JAR_PATH $SERVER_ARGS || { echo 'Servidor crashou ou parou.'; read -p 'Pressione Enter para fechar...' ; }"
    else
        # Executa diretamente
        "$JAR_PATH" $SERVER_ARGS
    fi
else
    # Execução Java Padrão (para arquivos .jar)
    echo " > Argumentos Java: $JAVA_ARGS"

    if [ -n "$CMD_PREFIX" ]; then
        exec $CMD_PREFIX "java -Xms${MIN_RAM} -Xmx${MAX_RAM} $JAVA_ARGS -jar \"$JAR_PATH\" $SERVER_ARGS || { echo 'Servidor crashou ou parou.'; read -p 'Pressione Enter para fechar...' ; }"
    else
        java -Xms"${MIN_RAM}" -Xmx"${MAX_RAM}" $JAVA_ARGS -jar "$JAR_PATH" $SERVER_ARGS
    fi
fi
