// 00-header.js — шапка вендора: что это за копия и чем она отличается от источника.
// relay.js — ВЕНДОР dsh-relay 0.3.0 (host-половина), только чтение.
// Копия собранного пакета, чтобы не требовать установки dsh-relay. Ссылка на
// sourcemap срезана: рядом её нет. Зависимости @deepseek-ai/schemastery и qrcode
// объявлены в package.json этого пакета. Браузерная половина relay НЕ вендрится:
// harness допускает один браузерный модуль на пакет, а он занят мобильным слоем.
// Страницы входа и спаривания relay отдаёт сам, с host-половины.
//
// ЕДИНСТВЕННАЯ ПРАВКА против источника — маршрут `GET /relay/pair.json` (см.
// обработчик ниже): он отдаёт то же приглашение, что и страница `/relay/pair`,
// но данными. Раздел «Mobile UI» в настройках harness показывает QR и код у себя,
// а приглашение живёт в памяти relay и больше нигде не доступно.
import { homedir, hostname, networkInterfaces } from "node:os";
import { X509Certificate, createHash, createHmac, randomBytes, randomInt, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import z from "@deepseek-ai/schemastery";
import { join, resolve } from "node:path";
import QRCode from "qrcode";
import { createServer, request } from "node:http";
import { createServer as createServer$1 } from "node:https";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { brotliCompress, constants as zlibConstants, gunzip } from "node:zlib";

