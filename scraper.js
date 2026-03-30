const { connect } = require('puppeteer-real-browser');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function iniciarScraper() {
    console.log('--- Operação Dismatal: Coleta Avançada (Preço + Nome + Estoque) ---');

    const { browser, page } = await connect({
        args: ["--start-maximized", "--no-sandbox"],
        headless: false,
        customConfig: {},
        skipTargetCheck: true
    });

    try {
        await page.setUserAgent(process.env.USER_AGENT_REAL);
        await page.setViewport({ width: 1366, height: 768 });

        // 1. LOGIN (Usando a técnica que funcionou)
        console.log('Passo 1: Autenticando...');
        await page.goto('https://b2b.dismatal.com.br/', { waitUntil: 'networkidle2', timeout: 60000 });
        await new Promise(res => setTimeout(res, 10000));

        await page.evaluate(() => {
            const btn = [...document.querySelectorAll('span, a, div')].find(el => el.innerText.includes('faça seu login'));
            if (btn) {
                const el = btn.closest('a') || btn;
                ['mouseenter', 'mousedown', 'mouseup', 'click'].forEach(t => {
                    el.dispatchEvent(new MouseEvent(t, { bubbles: true, buttons: 1 }));
                });
            }
        });

        await new Promise(res => setTimeout(res, 8000));

        // Injeção de dados via frames ou página principal
        const frames = page.frames();
        let loginContext = page;
        for (const f of frames) {
            if (await f.$('input[type="password"]')) { loginContext = f; break; }
        }

        const preencheu = await loginContext.evaluate((u, p) => {
            const inputs = [...document.querySelectorAll('input')];
            const user = inputs.find(i => i.type === 'text' || i.name.includes('login'));
            const pass = inputs.find(i => i.type === 'password');
            if (user && pass) {
                user.value = u; pass.value = p;
                user.dispatchEvent(new Event('input', { bubbles: true }));
                pass.dispatchEvent(new Event('input', { bubbles: true }));
                return true;
            }
            return false;
        }, process.env.DISMATAL_USER, process.env.DISMATAL_PASS);

        if (preencheu) {
            await page.keyboard.press('Enter');
            console.log('Login enviado. Aguardando 15s...');
            await new Promise(res => setTimeout(res, 15000));
        }

        // 2. EXTRAÇÃO DE DADOS
        const urlAlvo = 'https://b2b.dismatal.com.br/produtos/1135574';
        console.log('Passo 2: Extraindo dados do produto...');
        await page.goto(urlAlvo, { waitUntil: 'networkidle2' });
        await new Promise(res => setTimeout(res, 8000));

        const dadosProduto = await page.evaluate(() => {
            // A. Capturar Nome
            const nome = document.querySelector('h1')?.innerText?.trim() || 
                         document.querySelector('.product-name')?.innerText?.trim() || 
                         "Produto não identificado";

            // B. Capturar Menor Preço (Promoção)
            const matches = [...document.body.innerText.matchAll(/R\$\s?([0-9.,]+)/g)];
            const precosDisponiveis = matches.map(m => {
                return parseFloat(m[1].replace(/\./g, '').replace(',', '.'));
            }).filter(n => n > 0);
            
            const menorPreco = precosDisponiveis.length > 0 ? Math.min(...precosDisponiveis) : null;

            // C. Capturar Estoque
            const texto = document.body.innerText.toLowerCase();
            let statusEstoque = "Não identificado";
            
            // Busca por padrões numéricos ou texto
            const matchEstoque = texto.match(/(\d+)\s*(unidade|unid|un)/);
            if (matchEstoque) {
                statusEstoque = `${matchEstoque[1]} unidades`;
            } else if (texto.includes('em estoque') || texto.includes('disponível')) {
                statusEstoque = "Disponível";
            } else if (texto.includes('esgotado') || texto.includes('indisponível')) {
                statusEstoque = "Esgotado";
            }

            return { nome, preco: menorPreco, estoque: statusEstoque };
        });

        // 3. SALVAR NO SUPABASE
        if (dadosProduto.preco) {
            console.log(`✅ RESULTADO: ${dadosProduto.nome} | R$ ${dadosProduto.preco} | ${dadosProduto.estoque}`);
            
            const { error } = await supabase.from('precos_dismatal').insert({
                sku: '1135574',
                nome_produto: dadosProduto.nome,
                preco: dadosProduto.preco,
                estoque: dadosProduto.estoque,
                url: urlAlvo
            });

            if (error) throw error;
            console.log('Dados salvos com sucesso no Supabase!');
        } else {
            console.log('❌ Falha ao encontrar o preço na página final.');
            await page.screenshot({ path: 'erro-captura-final.png', fullPage: true });
        }

    } catch (err) {
        console.error('ERRO CRÍTICO:', err.message);
        process.exit(1);
    } finally {
        await browser.close();
    }
}

iniciarScraper();
