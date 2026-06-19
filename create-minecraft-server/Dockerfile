FROM eclipse-temurin:21-jdk-jammy

RUN apt-get update && \
    apt-get install -y curl jq wget screen nano vim && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /minecraft

# Copiar os scripts do repositório para dentro da imagem
COPY create-server.sh /minecraft/
COPY download-server.sh /minecraft/
COPY init-server.sh /minecraft/
COPY server.config.example /minecraft/server.config

# Tornar todos executáveis
RUN chmod +x *.sh

# Um script de entrada que garante que o servidor baixe e inicie automaticamente
RUN echo '#!/bin/bash\n\
export SERVICE_MODE=true\n\
echo "Eula=true" > eula.txt\n\
echo "Fazendo o download inicial do servidor..."\n\
./download-server.sh\n\
echo "Iniciando o servidor..."\n\
exec ./init-server.sh\n\
' > /minecraft/entrypoint.sh && chmod +x /minecraft/entrypoint.sh

# A porta padrão do Minecraft
EXPOSE 25565

ENTRYPOINT ["/minecraft/entrypoint.sh"]
