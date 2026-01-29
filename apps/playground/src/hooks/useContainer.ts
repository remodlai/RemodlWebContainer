import { useEffect, useRef, useState } from 'react';
import { ContainerManager } from '@remodl-web-container/api';


export function useContainer() {
    const containerRef = useRef<ContainerManager | null>(null);
    const [ready, setReady] = useState(false);
    const [servers, setServers] = useState<number[]>([]);

    useEffect(() => {        
        if (!containerRef.current||!ready) return
        let interval = setInterval(() => {
            containerRef.current?.listActiveServers().then((resp)=>{
                let {ports}=resp
                setServers(ports)
        });
        }, 1000);
        return ()=>{
            clearInterval(interval)
        }
    }, [ready]);
    useEffect(() => {
        containerRef.current = new ContainerManager({
            onServerListen: (port) => {
                console.log('Server listening on port', port);
                setServers(Array.from(new Set([...servers, port])));
            },
            onServerClose: (port) => {
                console.log('Server closed on port', port);
                setServers(servers.filter((s) => s !== port));
            }
        });
        containerRef.current.waitForReady().then(() => {
            setReady(true);
        });

        return () => {
            containerRef.current?.dispose();
        };
    }, []);

    return {
        ready,
        container: containerRef.current,    
        servers
    };
}
