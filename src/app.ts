import cookieParser from "cookie-parser";
import  express, { Application, Request, Response } from "express"; 
import cors from "cors";
import config from "./config";

const app : Application = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(cors({
    origin: config.APP_URL,    
    credentials: true
}));


app.get("/", (req : Request,res : Response) => {
    res.send("Hello World");
})

export default app;
 