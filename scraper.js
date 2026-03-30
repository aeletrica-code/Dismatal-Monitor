const { connect } = require('puppeteer-real-browser');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function iniciarScraper() {
    console.log('--- Operação Dismatal: Versão 9.0 (Foco Total em Resultados) ---');

    const { browser, page } = await connect({
        args: ["--start-maximized", "--no-sandbox"],
        headless: false,
        customConfig: {},
        skipTargetCheck: true
    });

    try {
        await page.setUserAgent(process.env.USER_AGENT_REAL);
        await page.setViewport({ width: 1366, height: 768 });

        // 1. ACESSO À HOME
        console.log('Passo 1: Carregando Home e aguardando 20s...');
        await page.goto('https://b2b.dismatal.com.br/', { waitUntil: 'networkidle2', timeout: 90000 });
        await new Promise(res => setTimeout(res, 20000)); // Tempo extra para o B2B carregar scripts

        // 2. TENTATIVA TRIPLA DE ABRIR MODAL
        console.log('Passo 2: Tentando abrir Modal (Clique + Teclado)...');
        
        const loginBotao = await page.evaluateHandle(() => {
            const el = [...document.querySelectorAll('a, div, span')].find(e => e.innerText.includes('faça seu login'));
            return el ? (el.closest('a') || el) : null;
        });

        if (loginBotao) {
            // A. Tenta focar e apertar ENTER (Geralmente ignora bloqueios de clique)
            await loginBotao.focus();
            await page.keyboard.press('Enter');
            console.log('Comando "Enter" enviado ao botão.');
            
            // B. Clique físico por precaução
            const box = await loginBotao.boundingBox();
            if (box) {
                await page.mouse.click(box.x + 5, box.y + 5); 
            }
        }

        console.log('Aguardando modal aparecer...');
        await new Promise(res => setTimeout(res, 15000));
        await page.screenshot({ path: '01-pos-tentativa-modal.png' });

        // 3. INFILTRAÇÃO E PREENCHIMENTO
        let frameAlvo = page;
        for (const f of page.frames()) {
            if (await f.$('input[type="password"]')) {
                frameAlvo = f;
                console.log('✅ Frame de login identificado!');
                break;
            }
        }

        const temCampos = await frameAlvo.$('input[type="password"]');
        if (temCampos) {
            await frameAlvo.evaluate((u, p) => {
                const inputs = [...document.querySelectorAll('input')];
                const user = inputs.find(i => i.type === 'text' || i.name.includes('login'));
                const pass = inputs.find(i => i.type === 'password');
                if (user && pass) {
                    user.value = u; pass.value = p;
                    user.dispatchEvent(new Event('input', { bubbles: true }));
                }
            }, process.env.DISMATAL_USER, process.env.DISMATAL_PASS);

            await page.keyboard.press('Enter');
            console.log('Login enviado. Aguardando 15s...');
            await new Promise(res => setTimeout(res, 15000));
        } else {
            console.log('⚠️ Modal não abriu. Tentando capturar preço de forma pública...');
        }

        // 4. COLETA DO PRODUTO (SKU 1135574)
        console.log('Passo 4: Analisando SKU...');
        await page.goto('https://b2b.dismatal.com.br/produtos/1135574', { waitUntil: 'networkidle2' });
        await new Promise(res => setTimeout(res, 10000));
        await page.screenshot({ path: '02-produto-final.png' });

        const dados = await page.evaluate(() => {
            const h1 = document.querySelector('h1')?.innerText?.trim() || "Produto Dismatal";
            
            // Lógica do MENOR PREÇO (Math.min para pegar os R$ 210,06)
            const regex = /R\$\s?([0-9.,]+)/g;
            const matches = [...document.body.innerText.matchAll(regex)];
            const precos = matches.map(m => {
                return parseFloat(m[1].replace(/\./g, '').replace(',', '.'));
            }).filter(v => v > 0);
            
            const precoFinal = precos.length > 0 ? Math.min(...precos) : null;

            // Lógica de Estoque
            const texto = document.body.innerText.toLowerCase();
            let estoqueInfo = "Não informado";
            const matchQtd = texto.match(/(\d+)\s*(unidade|unid|un)/);
            
            if (matchQtd) {
                estoqueInfo = `${matchQtd[1]} unidades`;
            } else if (texto.includes('em estoque') || texto.includes('disponível')) {
                estoqueInfo = "Em estoque";
            }

            return { nome: h1, preco: precoFinal, estoque: estoqueInfo };
        });

        // 5. GRAVAÇÃO NO SUPABASE
        if (dados.preco) {
            console.log(`🚀 RESULTADO: ${dados.nome} | R$ ${dados.preco} | Estoque: ${dados.estoque}`);
            
            await supabase.from('precos_dismatal').insert({
                sku: '1135574',
                nome_produto: dados.nome,
                preco: dados.preco,
                estoque: dados.estoque,
                url: 'https://b2b.dismatal.com.br/produtos/1135574'
            });
            console.log('Dados salvos no Supabase com sucesso!');
        } else {
            console.log('❌ Falha Final: Preço não encontrado.');
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
