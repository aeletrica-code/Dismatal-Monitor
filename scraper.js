const { connect } = require('puppeteer-real-browser');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function iniciarScraper() {
    console.log('--- Operação Dismatal: Busca em Frames ---');

    const { browser, page } = await connect({
        args: ["--start-maximized", "--no-sandbox"],
        headless: false,
        customConfig: {},
        skipTargetCheck: true
    });

    try {
        await page.setUserAgent(process.env.USER_AGENT_REAL);
        await page.setViewport({ width: 1366, height: 768 });

        console.log('Passo 1: Carregando Home...');
        await page.goto('https://b2b.dismatal.com.br/', { waitUntil: 'networkidle2', timeout: 60000 });
        await new Promise(res => setTimeout(res, 8000));

        console.log('Passo 2: Clicando para abrir o Pop-up...');
        await page.evaluate(() => {
            const btn = [...document.querySelectorAll('a, span, div')].find(el => el.innerText.includes('faça seu login'));
            if (btn) btn.click();
        });

        console.log('Aguardando 10 segundos pela renderização do Modal...');
        await new Promise(res => setTimeout(res, 10000));
        await page.screenshot({ path: '01-pos-clique-debug.png' });

        // 🚩 A MÁGICA: Procurar os campos em todos os frames (quadros) da página
        console.log('Varrendo frames em busca dos campos de login...');
        let loginFrame = null;
        const frames = page.frames();
        
        for (const frame of frames) {
            const hasPassword = await frame.$('input[type="password"]');
            if (hasPassword) {
                loginFrame = frame;
                console.log(`✅ Frame de login localizado: ${frame.url()}`);
                break;
            }
        }

        // Se não achou no frame, tenta na página principal (caso não seja iframe)
        const alvo = loginFrame || page;

        console.log('Passo 3: Preenchendo campos...');
        const inputSenha = await alvo.waitForSelector('input[type="password"]', { timeout: 15000 });
        
        if (inputSenha) {
            // Localiza todos os inputs no contexto certo (frame ou página)
            const inputs = await alvo.$$('input');
            for (let input of inputs) {
                const type = await (await input.getProperty('type')).jsonValue();
                if (type === 'text' || type === 'email' || type === 'number') {
                    await input.click({ clickCount: 3 });
                    await input.type(process.env.DISMATAL_USER, { delay: 100 });
                } else if (type === 'password') {
                    await input.type(process.env.DISMATAL_PASS, { delay: 100 });
                }
            }

            await page.screenshot({ path: '02-dados-preenchidos.png' });
            await page.keyboard.press('Enter');
            console.log('Login enviado! Aguardando 15s para processar...');
            await new Promise(res => setTimeout(res, 15000));
        }

        // Passo 4: Verificação Final
        console.log('Indo para o produto...');
        await page.goto('https://b2b.dismatal.com.br/produtos/1135574', { waitUntil: 'networkidle2' });
        await new Promise(res => setTimeout(res, 10000));
        await page.screenshot({ path: '03-resultado-final.png' });

        const data = await page.evaluate(() => {
            const m = document.body.innerText.match(/R\$\s?([0-9.,]+)/);
            return {
                preco: m ? m[0] : null,
                logado: !document.body.innerText.includes('faça seu login')
            };
        });

        if (data.preco) {
            const valor = parseFloat(data.preco.replace(/[^\d,]/g, '').replace(',', '.'));
            console.log(`✅ SUCESSO DISMATAL: R$ ${valor}`);
            await supabase.from('precos_dismatal').insert({
                sku: '1135574',
                nome_produto: 'Disjuntor Dismatal',
                preco: valor,
                url: 'https://b2b.dismatal.com.br/produtos/1135574'
            });
        } else {
            console.log(`❌ Falha: Preço não achado. Logado? ${data.logado}`);
            process.exit(1);
        }

    } catch (err) {
        console.error('ERRO:', err.message);
        await page.screenshot({ path: 'ERRO-DEBUG.png', fullPage: true });
        process.exit(1);
    } finally {
        await browser.close();
    }
}

iniciarScraper();
