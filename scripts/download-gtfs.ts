import { Readable } from 'stream';
import { finished } from 'stream/promises';
import path from 'path';
import fs from 'fs';
import 'dotenv/config';

async function downloadGTFS() {
    console.log('--- Startar nedladdning av GTFS-data ---');
    const url = process.env.SWEDEN_ZIP;
    if (!url) {
        console.error('FEL: Miljövariabeln SWEDEN_ZIP saknas i .env');
        process.exit(1);
    }

    const dataDir = path.resolve(process.cwd(), 'data/raw');
    const zipPath = path.join(dataDir, 'sweden.zip');

    const tempZipPath = `${zipPath}.tmp`;

    // Skapa kataloger om de inte finns
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }

    console.log(`Laddar ner GTFS från: ${url}`);
    
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP-fel: ${response.status} ${response.statusText}`);
        }

        if (!response.body) {
            throw new Error('Responsen saknar innehåll (body).');
        }

        const fileStream = fs.createWriteStream(tempZipPath);
        
        // Hämta strömmen och dirigera den till den temporära filen
        await finished(Readable.fromWeb(response.body as any).pipe(fileStream));

        // Ersätt den gamla filen med den nya som nyss laddades ner
        if (fs.existsSync(zipPath)) {
            fs.unlinkSync(zipPath);
        }
        fs.renameSync(tempZipPath, zipPath);

        console.log(`Nedladdningen lyckades! Filen har sparats till: ${zipPath}`);
    } catch (error) {
        if (fs.existsSync(tempZipPath)) {
            try { fs.unlinkSync(tempZipPath); } catch {}
        }
        console.error('Ett fel uppstod under nedladdningen:', error);
        process.exit(1);
    }
}

downloadGTFS();
