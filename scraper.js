const { connect } = require('puppeteer-real-browser');
const { createClient } = require('@supabase/supabase-js');

// Verificação de segurança das chaves
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
    console.error("❌ ERRO: SUPABASE_URL ou SUPABASE_KEY (service_role) não configurados.");
    process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function iniciarScraper() {
    console.log('--- Kore E-com: Coleta Dismatal Iniciada ---');

    const { browser, page } = await connect({
        args: ["--start-maximized", "--no-sandbox"],
        headless: false,
        customConfig: {},
        skipTargetCheck: true
    });

    try {
        // Aplica o disfarce de navegador real
        await page.setUserAgent(process.env.USER_AGENT_REAL);
        await page.setViewport({ width: 1366, height: 768 });

        // Passo 1: Login
        console.log('Passo 1: Autenticando no portal B2B...');
        await page.goto('https://b2b.dismatal.com.br/login', { waitUntil: 'networkidle2' });
        
        await page.waitForSelector('input[name="login"], #login', { timeout: 15000 });
        await page.type('input[name="login"], #login', process.env.DISMATAL_USER, { delay: 100 });
        await page.type('input[type="password"]', process.env.DISMATAL_PASS, { delay: 100 });
        
        await page.click('button[type="submit"], .btn-login');
        
        // Espera o login ser processado e redirecionar
        await new Promise(res => setTimeout(res, 15000));
        await page.screenshot({ path: '01-pos-login.png' });

        // Passo 2: Acesso ao Produto
        const skuAlvo = '1135574';
        const urlProduto = `https://b2b.dismatal.com.br/produtos/${skuAlvo}`;
        console.log(`Passo 2: Acessando produto ${skuAlvo}...`);
        
        await page.goto(urlProduto, { waitUntil: 'networkidle2' });
        await new Promise(res => setTimeout(res, 10000)); // Espera carregar o preço
        await page.screenshot({ path: '02-pagina-produto.png' });

        // Passo 3: Extração do Preço e Nome
        const data = await page.evaluate(() => {
            const body = document.body.innerText;
            const logado = !body.includes('Entrar') && !body.includes('Cadastrar');
            
            // Regex para capturar R$ 00,00
            const precoMatch = body.match(/R\$\s?([0-9.,]+)/);
            const nomeProduto = document.querySelector('h1')?.innerText || "Produto Dismatal";

            return {
                isLogado: logado,
                precoTexto: precoMatch ? precoMatch[1] : null,
                nome: nomeProduto.trim()
            };
        });

        console.log(`Status de Login: ${data.isLogado} | Preço Encontrado: ${data.precoTexto}`);

        if (data.precoTexto && data.isLogado) {
            // Limpa o valor (remove ponto de milhar e troca vírgula por ponto)
            const valorFinal = parseFloat(data.precoTexto.replace(/\./g, '').replace(',', '.'));
            
            console.log(`✅ SUCESSO! R$ ${valorFinal} pronto para o Supabase.`);

            // Inserção na tabela específica da Dismatal
            const { error } = await supabase.from('precos_dismatal').insert({
                sku: skuAlvo,
                nome_produto: data.nome,
                preco: valorFinal,
                url: urlProduto
            });

            if (error) {
                console.error('❌ Erro no Supabase:', error.message);
                process.exit(1);
            }
            console.log('Dados registrados com sucesso!');
        } else {
            console.log('❌ Falha: Robô deslogado ou preço não carregou no HTML.');
            await page.screenshot({ path: 'erro-coleta.png', fullPage: true });
            process.exit(1);
        }

    } catch (err) {
        console.error('FALHA GERAL:', err.message);
        process.exit(1);
    } finally {
        await browser.close();
    }
}

iniciarScraper();
