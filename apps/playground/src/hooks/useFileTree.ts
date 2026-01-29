import { ContainerManager } from '@remodl-web-container/api';
import { useEffect, useMemo, useState } from 'react';

interface FileSystemNode {
    name: string;
    type: 'file' | 'directory';
    path: string;
    children?: FileSystemNode[];
}

export function useFileTree(containerReady:boolean,container:ContainerManager|null) {
    const [paths, setPaths] = useState<string[]>([]);

    useEffect(() => {
        if(containerReady&&container){
            container.listFiles()
            .then(newPaths => {
                setPaths(newPaths||[]);
            });
        }
    }, [containerReady,container]);


    // set a clock to monitor file changes
    useEffect(() => {
        let interval=setInterval(() => {
            if(containerReady&&container){
                container.listFiles()
                .then(newPaths => {
                    setPaths(newPaths||[]);
                });
            }
        }, 1000);

        return () => {
            clearInterval(interval);
        };
        
    }, [containerReady,container]);

    return useMemo(() => {
        const root: FileSystemNode = {
            name: '/',
            type: 'directory',
            path: '/',
            children: []
        };

        // First pass: create all directories
        const ensureDirectory = (path: string) => {
            const parts = path.split('/').filter(Boolean);
            let current = root;
            let currentPath = '';

            for (const part of parts) {
                currentPath += '/' + part;
                if (!current.children) {
                    current.children = [];
                }

                let next = current.children.find(node => node.path === currentPath);
                if (!next) {
                    next = {
                        name: part,
                        type: 'directory',
                        path: currentPath,
                        children: []
                    };
                    current.children.push(next);
                }
                current = next;
            }
            return current;
        };

        // Second pass: add all files
        for (const path of paths) {
            if (path === '/') continue;

            const parts = path.split('/').filter(Boolean);
            const fileName = parts.pop()!;
            const dirPath = '/' + parts.join('/');

            const parent = dirPath === '/' ? root : ensureDirectory(dirPath);
            if (!parent.children) {
                parent.children = [];
            }

            parent.children.push({
                name: fileName,
                type: 'file',
                path: path
            });
        }

        // Sort children: directories first, then files, both alphabetically
        const sortChildren = (node: FileSystemNode) => {
            if (node.children) {
                node.children.sort((a, b) => {
                    if (a.type === b.type) {
                        return a.name.localeCompare(b.name);
                    }
                    return a.type === 'directory' ? -1 : 1;
                });
                node.children.forEach(sortChildren);
            }
        };
        sortChildren(root);

        return [root];
    }, [paths]);
}
