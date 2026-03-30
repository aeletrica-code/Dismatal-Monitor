const { connect } = require('puppeteer-real-browser');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function iniciarScraper() {
    console.log('--- Kore E-com: Operação Dismatal (Foco em Promoção + Estoque) ---');

    const { browser, page } = await connect({
        args: ["--start-maximized", "--no-sandbox"],
        headless: false,
        customConfig: {},
        skipTargetCheck: true
    });

    try {
        await page.setUserAgent(process.env.USER_AGENT_REAL);
        await page.setViewport({ width: 1366, height: 768 });

        // 1. HOME E LOGIN
        console.log('Passo 1: Acessando Home...');
        await page.goto('https://b2b.dismatal.com.br/', { waitUntil: 'networkidle2', timeout: 90000 });
        await new Promise(res => setTimeout(res, 10000));

        console.log('Passo 2: Disparando Login (Blizzard de Eventos)...');
        await page.evaluate(() => {
            const btn = [...document.querySelectorAll('a, span, div')].find(el => el.innerText.includes('faça seu login'));
            if (btn) {
                const el = btn.closest('a') || btn;
                // Simula sequência humana completa para enganar o firewall
                ['mouseenter', 'mouseover', 'mousedown', 'mouseup', 'click'].forEach(t => {
                    el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, buttons: 1 }));
                });
            }
        });

        console.log('Aguardando modal e frames...');
        await new Promise(res => setTimeout(res, 15000));
        await page.screenshot({ path: '01-debug-modal.png' });

        // 2. INFILTRAÇÃO (BUSCA POR FRAMES)
        let context = page;
        const frames = page.frames();
        for (const f of frames) {
            if (await f.$('input[type="password"]')) {
                context = f;
                console.log('✅ Frame de login localizado.');
                break;
            }
        }

        console.log('Passo 3: Preenchendo credenciais...');
        const inputSenha = await context.$('input[type="password"]');
        if (inputSenha) {
            await context.evaluate((u, p) => {
                const campos = [...document.querySelectorAll('input')];
                const user = campos.find(i => i.type === 'text' || i.name.includes('login'));
                const pass = campos.find(i => i.type === 'password');
                if (user && pass) {
                    user.value = u; pass.value = p;
                    user.dispatchEvent(new Event('input', { bubbles: true }));
                }
            }, process.env.DISMATAL_USER, process.env.DISMATAL_PASS);
            
            await page.keyboard.press('Enter');
            console.log('Login enviado. Aguardando processamento...');
            await new Promise(res => setTimeout(res, 20000));
        } else {
            console.log('⚠️ Modal não detectado no print 01. Tentando seguir...');
        }

        // 3. COLETA DE DADOS (PREÇO PROMO + NOME + ESTOQUE)
        const sku = '1135574';
        const url = `https://b2b.dismatal.com.br/produtos/${sku}`;
        console.log(`Passo 4: Analisando SKU ${sku}...`);
        await page.goto(url, { waitUntil: 'networkidle2' });
        await new Promise(res => setTimeout(res, 10000));
        await page.screenshot({ path: '02-produto-final.png' });

        const dados = await page.evaluate(() => {
            // Nome do Produto
            const nome = document.querySelector('h1')?.innerText?.trim() || document.title.split('|')[0].trim();

            // Lógica do Menor Preço (Sniper para pegar os R$ 210,06)
            const precoMatches = [...document.body.innerText.matchAll(/R\$\s?([0-9.,]+)/g)];
            const valores = precoMatches.map(m => {
                return parseFloat(m[1].replace(/\./g, '').replace(',', '.'));
            }).filter(v => v > 0);
            const menorPreco = valores.length > 0 ? Math.min(...valores) : null;

            // Lógica de Estoque
            const texto = document.body.innerText.toLowerCase();
            let estoqueStatus = "Indisponível";
            const matchQtd = texto.match(/(\d+)\s*(unidade|unid|un)/);
            
            if (matchQtd) {
                estoqueStatus = `${matchQtd[1]} unidades`;
            } else if (texto.includes('em estoque') || texto.includes('disponível')) {
                estoqueStatus = "Em Estoque";
            }

            return { nome, preco: menorPreco, estoque: estoqueStatus };
        });

        // 4. SUPABASE
        if (dados.preco) {
            console.log(`🚀 SUCESSO: ${dados.nome} | R$ ${dados.preco} | Estoque: ${dados.estoque}`);
            
            await supabase.from('precos_dismatal').insert({
                sku: sku,
                nome_produto: dados.nome,
                preco: dados.preco,
                estoque: dados.estoque,
                url: url
            });
            console.log('Dado salvo no Supabase.');
        } else {
            console.log('❌ Falha: Preço não localizado na página final.');
            process.exit(1);
        }

    } catch (err) {
        console.error('ERRO:', err.message);
        await page.screenshot({ path: 'ERRO-CRITICO.png' });
        process.exit(1);
    } finally {
        await browser.close();
    }
}

iniciarScraper();
