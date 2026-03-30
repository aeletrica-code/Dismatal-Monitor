const { connect } = require('puppeteer-real-browser');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function iniciarScraper() {
    console.log('--- Operação Dismatal: Forçando Abertura de Pop-up ---');

    const { browser, page } = await connect({
        args: ["--start-maximized", "--no-sandbox"],
        headless: false,
        customConfig: {},
        skipTargetCheck: true
    });

    try {
        await page.setUserAgent(process.env.USER_AGENT_REAL);
        await page.setViewport({ width: 1366, height: 768 });

        // 1. CARREGAMENTO DA HOME
        console.log('Passo 1: Carregando Home...');
        await page.goto('https://b2b.dismatal.com.br/', { waitUntil: 'networkidle2', timeout: 90000 });
        
        // Espera 15 segundos para o site carregar todos os scripts do pop-up
        await new Promise(res => setTimeout(res, 15000));
        await page.screenshot({ path: '01-home-carregada.png' });

        // 2. DISPARO DO POP-UP (CLIQUE POR COORDENADA)
        console.log('Passo 2: Localizando e clicando no botão de login...');
        
        const loginCoords = await page.evaluate(() => {
            const el = [...document.querySelectorAll('a, div, span')].find(e => e.innerText.includes('faça seu login'));
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        });

        if (loginCoords) {
            // Move o mouse e clica fisicamente
            await page.mouse.move(loginCoords.x, loginCoords.y, { steps: 10 });
            await page.mouse.click(loginCoords.x, loginCoords.y);
            console.log('Clique físico executado nas coordenadas.');
        } else {
            console.log('⚠️ Botão não achado via texto. Tentando clique direto no seletor...');
            await page.click('.header-login, #header-user-login').catch(() => {});
        }

        // ESPERA CRUCIAL PELO IFRAME DO MODAL
        console.log('Aguardando 15s pela aparição do Modal (Iframe)...');
        await new Promise(res => setTimeout(res, 15000));
        await page.screenshot({ path: '02-pos-clique.png' });

        // 3. INFILTRAÇÃO NO MODAL
        let frameLogin = null;
        for (const f of page.frames()) {
            if (await f.$('input[type="password"]')) {
                frameLogin = f;
                console.log('✅ Frame de login localizado!');
                break;
            }
        }

        const alvo = frameLogin || page;
        const temSenha = await alvo.$('input[type="password"]');

        if (temSenha) {
            console.log('Preenchendo dados...');
            await alvo.evaluate((u, p) => {
                const fields = [...document.querySelectorAll('input')];
                const user = fields.find(i => i.type === 'text' || i.name.includes('login'));
                const pass = fields.find(i => i.type === 'password');
                if (user && pass) {
                    user.value = u; pass.value = p;
                    user.dispatchEvent(new Event('input', { bubbles: true }));
                }
            }, process.env.DISMATAL_USER, process.env.DISMATAL_PASS);

            await page.keyboard.press('Enter');
            console.log('Login enviado. Aguardando 20s...');
            await new Promise(res => setTimeout(res, 20000));
        } else {
            console.log('❌ O Pop-up não abriu ou os campos não carregaram.');
            process.exit(1);
        }

        // 4. COLETA DE DADOS (MENOR PREÇO + ESTOQUE)
        const sku = '1135574';
        console.log(`Passo 4: Analisando SKU ${sku}...`);
        await page.goto(`https://b2b.dismatal.com.br/produtos/${sku}`, { waitUntil: 'networkidle2' });
        await new Promise(res => setTimeout(res, 10000));
        await page.screenshot({ path: '03-resultado-final.png' });

        const dados = await page.evaluate(() => {
            const h1 = document.querySelector('h1')?.innerText?.trim() || "Produto Dismatal";
            
            // Lógica Sniper para o menor preço (R$ 210,06)
            const precos = [...document.body.innerText.matchAll(/R\$\s?([0-9.,]+)/g)]
                .map(m => parseFloat(m[1].replace(/\./g, '').replace(',', '.')))
                .filter(v => v > 0);
            const menorPreco = precos.length > 0 ? Math.min(...precos) : null;

            // Lógica de Estoque
            const texto = document.body.innerText.toLowerCase();
            let estoque = "Não informado";
            const match = texto.match(/(\d+)\s*(unidade|unid|un)/);
            if (match) {
                estoque = `${match[1]} unidades`;
            } else if (texto.includes('em estoque')) {
                estoque = "Disponível";
            }

            return { nome: h1, preco: menorPreco, estoque };
        });

        // 5. SALVAR NO SUPABASE
        if (dados.preco) {
            console.log(`🚀 SUCESSO: ${dados.nome} | R$ ${dados.preco} | Estoque: ${dados.estoque}`);
            await supabase.from('precos_dismatal').insert({
                sku: sku,
                nome_produto: dados.nome,
                preco: dados.preco,
                estoque: dados.estoque,
                url: `https://b2b.dismatal.com.br/produtos/${sku}`
            });
            console.log('Dados registrados!');
        } else {
            console.log('❌ Preço não encontrado na página final.');
            process.exit(1);
        }

    } catch (err) {
        console.error('ERRO:', err.message);
        await page.screenshot({ path: 'ERRO-FINAL.png' });
        process.exit(1);
    } finally {
        await browser.close();
    }
}

iniciarScraper();
