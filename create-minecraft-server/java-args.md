`-Xms<RAM>G -Xmx<RAM>G`:

-   Define a memória inicial e máxima iguais.

-   Por que: Evita o overhead de redimensionamento do Heap. Se o OS tiver que alocar novas páginas de memória no meio de um pico de lag, o servidor trava.
    `-XX:+UseG1GC`:

-   Ativa o coletor G1.

-   Por que: O G1 divide a memória em regiões pequenas. Ele pode limpar algumas regiões sem parar o servidor inteiro, ao contrário do antigo "Parallel GC" que parava o mundo para limpar.

`-XX:+AlwaysPreTouch`:

-   Obrigatório em Linux/Docker/Proxmox. Faz a JVM escrever um "zero" em cada página de memória alocada na inicialização.

-   Por que: Por padrão, o OS "promete" a RAM, mas só a entrega fisicamente quando o Java tenta escrever nela (Page Fault). Isso causa micro-travamentos durante o jogo. Essa flag força o OS a entregar a RAM física real no boot (o boot demora uns segundos a mais, mas o jogo roda liso).

`-XX:+DisableExplicitGC`:

-   Ignora chamadas de System.gc() no código.

-   Por que: Alguns plugins mal escritos tentam forçar a limpeza de memória manualmente. No G1GC, isso é desastroso porque força uma "Full GC" (pausa total), matando o TPS.

`-XX:+PerfDisableSharedMem`:

-   Desativa a escrita de estatísticas de performance em memória compartilhada (/tmp/hsperfdata).

-   Por que: Em Linux, se o I/O do disco estiver alto (ex: salvando o mundo), escrever nesse arquivo pode bloquear a JVM, causando lag spikes. Isso desvincula a performance do Java do I/O de disco.

`-XX:MaxGCPauseMillis=200`:

-   Define a meta de pausa máxima.

-   Por que: 200ms é um pouco menos que o tempo limite de desconexão/timeout de ticks críticos, mas dá ao GC tempo suficiente para trabalhar sem ser afobado demais (o que causaria uso excessivo de CPU).

`-XX:+ParallelRefProcEnabled`:

-   Usa múltiplas threads para processar referências fracas/suaves (weak/soft references).

-   Por que: O Minecraft usa muitas referências fracas. Sem isso, essa etapa roda em uma única thread e vira um gargalo.

`-XX:+UnlockExperimentalVMOptions`:

-   Necessário para ativar algumas das flags abaixo (como G1NewSizePercent em algumas versões do Java).

`XX:G1NewSizePercent=30` e `-XX:G1MaxNewSizePercent=40`:

-   Força a "Young Generation" (onde novos objetos nascem) a ser grande (30-40% da RAM total).

-   Por que: O padrão do Java é pequeno (5%). No Minecraft, queremos uma área enorme para novos objetos para que eles tenham tempo de "morrer" antes de serem promovidos para a memória de longo prazo. Isso reduz a frequência das coletas.

`-XX:G1HeapRegionSize=8M`:

-   Define o tamanho dos blocos de memória do G1.

-   Por que: Evita problemas com objetos "Humongous" (objetos maiores que 50% de uma região). 8M é o ideal para o tipo de dados do MC.

`-XX:G1ReservePercent=20`:

-   Mantém 20% da memória livre como "reserva de emergência".

-   Por que: Evita o temido "To-Space Exhaustion", que é quando o Java fica sem espaço para copiar objetos durante a limpeza, causando um travamento total do servidor.

`-XX:InitiatingHeapOccupancyPercent=15`:

-   Começa a limpar a memória antiga quando o heap total chega a 15% de uso (o padrão é 45%).

-   Por que: Queremos que o GC trabalhe cedo e constantemente em pequenas doses, em vez de esperar a memória encher e ter que trabalhar muito de uma vez.

`-XX:G1MixedGCCountTarget=4`:

-   Tenta espalhar a limpeza da memória antiga em 4 ciclos.

-   Por que: Evita tentar limpar tudo de uma vez. Divide o trabalho para não estourar o tempo de pausa.

`-XX:G1MixedGCLiveThresholdPercent=90`:

-   Diz ao GC: "Se uma região tem mais de 90% de dados úteis, nem perca tempo tentando limpá-la".

-   Por que: Limpar uma região cheia de dados úteis é custoso e recupera pouca memória. O foco é limpar regiões cheias de lixo.

`-XX:G1RSetUpdatingPauseTimePercent=5`:

-   Dedica 5% do tempo de pausa para atualizar "Remembered Sets" (mapas de onde estão os objetos).

-   Por que: Reduz a contenção durante as pausas de coleta.

`-XX:G1HeapWastePercent=5`:

-   Permite 5% de desperdício de heap.

-   Por que: O Java não precisa ser perfeccionista. É melhor deixar um pouco de lixo para trás do que gastar ciclos de CPU preciosos tentando limpar cada byte.

`-XX:SurvivorRatio=32`:

-   Define uma proporção drástica para as áreas de sobrevivência dentro da Young Gen.

-   Por que: No Minecraft, a vasta maioria dos objetos morre muito rápido. Pouquíssimos sobrevivem.

`-XX:MaxTenuringThreshold=1`:

-   A "Bala de Prata": Diz ao Java: "Se um objeto sobreviveu a 1 ciclo de limpeza, promova-o imediatamente para a Old Generation (memória de longo prazo)".

-   A Lógica Técnica: O padrão do Java é 15 ciclos. No Minecraft, se um objeto não morreu no primeiro tick, ele provavelmente é um bloco carregado, um dado de plugin ou um player. Não faz sentido ficar copiando esse dado de um lado para o outro na memória temporária 15 vezes. Mande-o logo para o "asilo" (Old Gen) e deixe a memória temporária livre para o próximo tick.
