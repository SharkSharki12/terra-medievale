// Horloge d'arrière-plan : les workers ne sont pas ralentis quand la fenêtre est cachée
setInterval(() => postMessage(1), 1000);
