import { defineConfig } from 'vite';
import {securityHeaders} from './src/security';
export default defineConfig({server:{host:'127.0.0.1',port:4180,strictPort:true,headers:securityHeaders},preview:{host:'127.0.0.1',port:4180,strictPort:true,headers:securityHeaders},build:{target:'es2022'}});
