const { connect } = require('puppeteer-real-browser');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function iniciarScraper() {
    console.log('--- Kore E-com: Operação Dismatal Avançada ---');

    const { browser, page } = await connect({
        args: ["--start-maximized", "--no-sandbox"],
        headless: false,
        customConfig: {},
        skipTargetCheck: true
    });

    try {
        await page.setUserAgent(process.env.USER_AGENT_REAL);
        await page.setViewport({ width: 1366, height: 768 });

        // PASSO 1: Carregamento e Verificação de Login
        console.log('Passo 1: Acessando Home...');
        await page.goto('https://b2b.dismatal.com.br/', { waitUntil: 'networkidle2', timeout: 90000 });
        await new Promise(res => setTimeout(res, 15000)); // Tempo extra para o site "acordar" no servidor

        // Verifica se já não estamos logados (sessão persistente)
        const estaLogado = await page.evaluate(() => {
            const texto = document.body.innerText;
            return texto.includes('Sair') || texto.includes('Minha Conta') || !texto.includes('faça seu login');
        });

        if (!estaLogado) {
            console.log('Passo 2: Tentando abrir o Login (Simulação Humana)...');
            
            const loginEl = await page.evaluateHandle(() => {
                const itens = [...document.querySelectorAll('a, span, div')];
                const alvo = itens.find(el => el.innerText.includes('faça seu login'));
                return alvo ? (alvo.closest('a') || alvo) : null;
            });

            if (loginEl) {
                const box = await loginEl.boundingBox();
                if (box) {
                    // Move o mouse suavemente até o botão
                    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 20 });
                    await new Promise(res => setTimeout(res, 1000));
                    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
                    console.log('Clique de login executado.');
                }
            }

            await new Promise(res => setTimeout(res, 12000));
            await page.screenshot({ path: '01-pos-clique-login.png' });

            // Identifica o contexto (Frame ou Página)
            let alvoLogin = page;
            const frames = page.frames();
            for (const f of frames) {
                if (await f.$('input[type="password"]')) { alvoLogin = f; break; }
            }

            console.log('Passo 3: Injetando dados de acesso...');
            const sucessoLogin = await alvoLogin.evaluate((u, p) => {
                const inputs = [...document.querySelectorAll('input')];
                const user = inputs.find(i => i.type === 'text' || i.name.includes('login') || i.id.includes('login'));
                const pass = inputs.find(i => i.type === 'password');
                if (user && pass) {
                    user.value = u; pass.value = p;
                    user.dispatchEvent(new Event('input', { bubbles: true }));
                    pass.dispatchEvent(new Event('input', { bubbles: true }));
                    return true;
                }
                return false;
            }, process.env.DISMATAL_USER, process.env.DISMATAL_PASS);

            if (sucessoLogin) {
                await page.keyboard.press('Enter');
                console.log('Dados enviados! Aguardando 20s para login completo...');
                await new Promise(res => setTimeout(res, 20000));
            } else {
                console.log('⚠️ Campos de login não encontrados. Verifique 01-pos-clique-login.png');
            }
        } else {
            console.log('Sessão já ativa. Pulando login...');
        }

        // PASSO 4: Coleta de Dados do Produto
        const urlProduto = 'https://b2b.dismatal.com.br/produtos/1135574';
        console.log(`Passo 4: Acessando produto...`);
        await page.goto(urlProduto, { waitUntil: 'networkidle2' });
        await new Promise(res => setTimeout(res, 10000));
        await page.screenshot({ path: '02-pagina-produto.png' });

        const dados = await page.evaluate(() => {
            // Nome
            const nome = document.querySelector('h1')?.innerText?.trim() || 
                         document.querySelector('.product-name')?.innerText?.trim() || 
                         document.title.split('|')[0].trim();

            // Preço (Pega todos e escolhe o MENOR - Promoção)
            const matches = [...document.body.innerText.matchAll(/R\$\s?([0-9.,]+)/g)];
            const precos = matches.map(m => {
                return parseFloat(m[1].replace(/\./g, '').replace(',', '.'));
            }).filter(n => n > 0);
            const menorPreco = precos.length > 0 ? Math.min(...precos) : null;

            // Estoque (Busca por palavras-chave ou números)
            const texto = document.body.innerText.toLowerCase();
            let estoque = "Indisponível";
            const matchQtd = texto.match(/(\d+)\s*(unidade|unid|un)/);
            
            if (matchQtd) {
                estoque = `${matchQtd[1]} unidades`;
            } else if (texto.includes('em estoque') || texto.includes('disponível')) {
                estoque = "Em Estoque";
            }

            return { nome, preco: menorPreco, estoque };
        });

        if (dados.preco) {
            console.log(`✅ SUCESSO! ${dados.nome} | R$ ${dados.preco} | ${dados.estoque}`);
            
            const { error } = await supabase.from('precos_dismatal').insert({
                sku: '1135574',
                nome_produto: dados.nome,
                preco: dados.preco,
                estoque: dados.estoque,
                url: urlProduto
            });

            if (error) throw error;
            console.log('Dados salvos no Supabase.');
        } else {
            console.log('❌ Falha ao extrair dados. O preço não foi localizado.');
            process.exit(1);
        }

    } catch (err) {
        console.error('ERRO CRÍTICO:', err.message);
        await page.screenshot({ path: 'ERRO-FINAL.png', fullPage: true });
        process.exit(1);
    } finally {
        await browser.close();
    }
}

iniciarScraper();
