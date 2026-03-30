const { connect } = require('puppeteer-real-browser');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function iniciarScraper() {
    console.log('--- Operação Dismatal: Versão 10.0 (Ajuste de Mira) ---');

    const { browser, page } = await connect({
        args: ["--start-maximized", "--no-sandbox"],
        headless: false,
        customConfig: {},
        skipTargetCheck: true
    });

    try {
        await page.setUserAgent(process.env.USER_AGENT_REAL);
        await page.setViewport({ width: 1366, height: 768 });

        // 1. ACESSO COM PACIÊNCIA
        console.log('Passo 1: Carregando Home (Esperando 25s para os scripts ativarem)...');
        await page.goto('https://b2b.dismatal.com.br/', { waitUntil: 'networkidle2', timeout: 90000 });
        await new Promise(res => setTimeout(res, 25000)); 

        // 2. TENTATIVA REPETITIVA DE LOGIN
        console.log('Passo 2: Tentando abrir o modal de login...');
        let modalAberto = false;
        
        for (let i = 1; i <= 3; i++) {
            console.log(`Tentativa de clique #${i}...`);
            await page.evaluate(() => {
                const btn = [...document.querySelectorAll('a, span, div')].find(el => el.innerText.includes('faça seu login'));
                if (btn) {
                    const clickTarget = btn.closest('a') || btn;
                    clickTarget.click();
                    // Dispara eventos manuais para garantir
                    ['mousedown', 'mouseup'].forEach(t => clickTarget.dispatchEvent(new MouseEvent(t, {bubbles: true})));
                }
            });

            await new Promise(res => setTimeout(res, 8000));
            const temSenha = await page.evaluate(() => !!document.querySelector('input[type="password"]'));
            
            if (temSenha) {
                modalAberto = true;
                console.log('✅ Modal de login detectado!');
                break;
            }
            await page.screenshot({ path: `tentativa-${i}.png` });
        }

        if (modalAberto) {
            console.log('Passo 3: Injetando credenciais...');
            await page.evaluate((u, p) => {
                const inputs = [...document.querySelectorAll('input')];
                const user = inputs.find(i => i.type === 'text' || i.name.includes('login'));
                const pass = inputs.find(i => i.type === 'password');
                if (user && pass) {
                    user.value = u; pass.value = p;
                    user.dispatchEvent(new Event('input', { bubbles: true }));
                }
            }, process.env.DISMATAL_USER, process.env.DISMATAL_PASS);

            await page.keyboard.press('Enter');
            await new Promise(res => setTimeout(res, 15000));
        } else {
            console.log('⚠️ Modal não abriu. Prosseguindo para tentar captura pública (último recurso).');
        }

        // 3. CAPTURA DO PRODUTO (FOCO NO MENOR PREÇO)
        const sku = '1135574';
        console.log(`Passo 4: Analisando SKU ${sku}...`);
        await page.goto(`https://b2b.dismatal.com.br/produtos/${sku}`, { waitUntil: 'networkidle2' });
        await new Promise(res => setTimeout(res, 10000));
        await page.screenshot({ path: '02-produto-final.png' });

        const info = await page.evaluate(() => {
            const h1 = document.querySelector('h1')?.innerText?.trim() || "Disjuntor/Produto Dismatal";
            
            // Lógica do MENOR PREÇO: Pega todos os "R$" e escolhe o menor (os 210,06)
            const matches = [...document.body.innerText.matchAll(/R\$\s?([0-9.,]+)/g)];
            const valores = matches.map(m => {
                return parseFloat(m[1].replace(/\./g, '').replace(',', '.'));
            }).filter(v => v > 0);
            
            const menorPreco = valores.length > 0 ? Math.min(...valores) : null;

            // Lógica de ESTOQUE: Busca números antes de "unidades" ou texto de disponibilidade
            const texto = document.body.innerText.toLowerCase();
            let estoqueStatus = "Consultar";
            const matchQtd = texto.match(/(\d+)\s*(unidade|unid|un)/);
            
            if (matchQtd) {
                estoqueStatus = `${matchQtd[1]} unidades`;
            } else if (texto.includes('em estoque') || texto.includes('disponível')) {
                estoqueStatus = "Em Estoque";
            }

            return { nome: h1, preco: menorPreco, estoque: estoqueStatus };
        });

        // 4. GRAVAÇÃO NO SUPABASE
        if (info.preco) {
            console.log(`🚀 SUCESSO: ${info.nome} | R$ ${info.preco} | Estoque: ${info.estoque}`);
            
            await supabase.from('precos_dismatal').insert({
                sku: sku,
                nome_produto: info.nome,
                preco: info.preco,
                estoque: info.estoque,
                url: `https://b2b.dismatal.com.br/produtos/${sku}`
            });
            console.log('Dados salvos no banco de dados!');
        } else {
            console.log('❌ Erro: Preço não encontrado. Verifique o print 02.');
            process.exit(1);
        }

    } catch (err) {
        console.error('ERRO:', err.message);
        await page.screenshot({ path: 'ERRO-OPERACAO.png' });
        process.exit(1);
    } finally {
        await browser.close();
    }
}

iniciarScraper();
